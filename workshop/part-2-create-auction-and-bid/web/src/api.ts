import { z } from 'zod';
export async function fetchJson<T>(url: string, schema: z.ZodType<T>, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ message: z.string(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional() }).safeParse(body);
    throw new Error(error.success ? [error.data.message, ...(error.data.issues ?? []).map(issue => `${issue.path.join('.')}: ${issue.message}`)].join(' ') : 'The request failed. Please try again.');
  }
  return schema.parse(body);
}
