import os from "node:os";

// U16 — 60-point ring buffer for admin home sparklines.
// One sample per 5 s × 60 = 5 min of history. Lossy by design.

export interface MetricSample {
  ts: number;        // unix ms
  cpu: number;       // 0..1 (1-min load avg ÷ cores)
  ramUsed: number;   // bytes
  ramTotal: number;  // bytes
  dbPoolTotal: number;
  dbPoolIdle: number;
  dbPoolWaiting: number;
}

const CAPACITY = 60;
const buffer: MetricSample[] = [];

export function pushSample(sample: MetricSample): void {
  buffer.push(sample);
  if (buffer.length > CAPACITY) {
    buffer.shift();
  }
}

export function snapshot(): MetricSample[] {
  return buffer.slice();
}

export function latest(): MetricSample | null {
  return buffer.length === 0 ? null : buffer[buffer.length - 1] ?? null;
}

/** Read current system metrics. dbPool fields are injected by the caller. */
export function captureSystemSample(dbPool: { total: number; idle: number; waiting: number }): MetricSample {
  const cores = Math.max(os.cpus().length, 1);
  const loadAvg = os.loadavg()[0] ?? 0;
  return {
    ts: Date.now(),
    cpu: Math.min(loadAvg / cores, 1),
    ramUsed: os.totalmem() - os.freemem(),
    ramTotal: os.totalmem(),
    dbPoolTotal: dbPool.total,
    dbPoolIdle: dbPool.idle,
    dbPoolWaiting: dbPool.waiting,
  };
}
