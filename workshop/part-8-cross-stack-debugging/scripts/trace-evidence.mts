import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';

export const machineTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const tag = z.object({ key: z.string(), value: z.unknown() });
export const traceSchema = z.object({ traceID: z.string(), spans: z.array(z.object({ traceID: z.string(), spanID: z.string(), processID: z.string(),
  operationName: z.string(), startTime: z.number(), duration: z.number(), tags: z.array(tag),
  references: z.array(z.object({ refType: z.string(), traceID: z.string(), spanID: z.string() })) })),
  processes: z.record(z.string(), z.object({ serviceName: z.string(), tags: z.array(tag) })) });
export type CollectedTrace = z.infer<typeof traceSchema>;
export function localTime(microseconds: number, longDate = false): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: machineTimeZone, year: 'numeric',
    month: longDate ? 'long' : '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    fractionalSecondDigits: 3, hourCycle: 'h23' }).formatToParts(new Date(microseconds / 1000)).map(part => [part.type, part.value]));
  const date = longDate ? `${parts.month} ${Number(parts.day)} ${parts.year},` : `${parts.year}-${parts.month}-${parts.day}`;
  return `${date} ${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`;
}
export async function waitForTrace(url: string, traceID: string, names: string[]): Promise<CollectedTrace> {
  // Waiting for the actual collected spans is stronger evidence than a fixed
  // sleep: leave application processes alive while their batches flush.
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const response = await fetch(`${url}/api/traces/${traceID}`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const result = z.object({ data: z.array(traceSchema) }).safeParse(await response.json());
      const trace = result.success ? result.data.data[0] : undefined;
      if (trace && names.every(name => trace.spans.some(span => span.operationName === name))) return trace;
    }
    await sleep(300);
  }
  assert.fail(`Jaeger did not collect the required spans for ${traceID}; processes have not been shut down`);
}
export function summarizeSpans(trace: CollectedTrace, names: string[]) {
  return trace.spans.filter(span => names.includes(span.operationName)).map(span => ({
    operation: span.operationName, service: trace.processes[span.processID].serviceName, spanId: span.spanID,
    parentSpanId: span.references.find(reference => reference.refType === 'CHILD_OF')?.spanID ?? null,
    startUTC: new Date(span.startTime / 1000).toISOString(), startLocal: localTime(span.startTime),
    timeZone: machineTimeZone, durationMs: span.duration / 1000, attributes: Object.fromEntries(span.tags.map(tag => [tag.key, tag.value])),
  })).sort((a, b) => a.startUTC.localeCompare(b.startUTC));
}
