import { z } from 'zod';
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly minimumBidCents?: number) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function fetchJson<T>(url: string, schema: z.ZodType<T>, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ message: z.string(), code: z.string().optional(), minimumBidCents: z.number().int().positive().optional(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional() }).safeParse(body);
    throw new ApiError(error.success ? [error.data.message, ...(error.data.issues ?? []).map(issue => `${issue.path.join('.')}: ${issue.message}`)].join(' ') : 'The request failed. Please try again.', response.status, error.success ? error.data.code : undefined, error.success ? error.data.minimumBidCents : undefined);
  }
  return schema.parse(body);
}
