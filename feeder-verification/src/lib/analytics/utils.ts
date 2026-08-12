/**
 * Analytics Query Optimization and Caching Utilities
 * Provides helpers for improving query performance and reliability
 */

import { logger } from "../logger";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const queryCache = new Map<string, CacheEntry<unknown>>();

/**
 * Get cached query result if available and not expired
 */
export function getCachedQuery<T>(key: string): T | null {
  const entry = queryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  const isExpired = Date.now() - entry.timestamp > entry.ttl * 1000;
  if (isExpired) {
    queryCache.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Set cached query result with TTL in seconds
 */
export function setCachedQuery<T>(key: string, data: T, ttlSeconds: number = 60): void {
  queryCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttlSeconds,
  });
}

/**
 * Clear all cached queries
 */
export function clearQueryCache(): void {
  queryCache.clear();
}

/**
 * Get cache stats for monitoring
 */
export function getCacheStats() {
  return {
    totalEntries: queryCache.size,
    estimatedSizeBytes: calculateMapSize(queryCache),
  };
}

function calculateMapSize(map: Map<string, unknown>): number {
  let size = 0;
  map.forEach((value) => {
    size += JSON.stringify(value).length;
  });
  return size;
}

/**
 * Build cache key from parameters
 */
export function buildCacheKey(
  prefix: string,
  params: Record<string, unknown> = {}
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}:${params[k]}`)
    .join("|");
  return `${prefix}:${sortedParams}`;
}

/**
 * Safe query execution with error handling
 */
export async function executeQuery<T>(
  queryFn: () => Promise<T>,
  fallback: T = [] as unknown as T
): Promise<T> {
  try {
    return await queryFn();
  } catch (error) {
    logger.error({ error }, "[Analytics Query] Execution failed:");
    return fallback;
  }
}

/**
 * Performance monitoring for queries
 */
export class QueryTimer {
  private start: number;
  private name: string;

  constructor(name: string) {
    this.name = name;
    this.start = Date.now();
  }

  end(): { name: string; durationMs: number } {
    const durationMs = Date.now() - this.start;
    if (durationMs > 1000) {
      logger.warn(`[Analytics] Slow query detected: ${this.name} took ${durationMs}ms`);
    }
    return { name: this.name, durationMs };
  }
}

/**
 * Batch multiple async operations with controlled concurrency
 */
export async function batchAsync<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  concurrency: number = 5
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map(fn));
  }
}

/**
 * Deduplicate array of objects by key
 */
export function deduplicateBy<T>(
  items: T[],
  keyFn: (item: T) => string
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Safely format number for display
 */
export function formatNumber(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  return String(value);
}

/**
 * Format percentage safely
 */
export function formatPercentage(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") {
    return `${Math.round(value * 100) / 100}%`;
  }
  return String(value);
}

/**
 * Format duration in minutes
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

/**
 * Format currency
 */
export function formatCurrency(value: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Validate analytics data quality
 */
export function validateAnalyticsData<T extends Record<string, unknown>>(
  data: T[]
): { valid: T[]; invalid: T[]; issues: string[] } {
  const issues: string[] = [];
  const valid: T[] = [];
  const invalid: T[] = [];

  data.forEach((item) => {
    const itemIssues: string[] = [];

    Object.entries(item).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        itemIssues.push(`Missing value for key: ${key}`);
      }
      if (typeof value === "number" && isNaN(value)) {
        itemIssues.push(`Invalid number for key: ${key}`);
      }
    });

    if (itemIssues.length > 0) {
      invalid.push(item);
      issues.push(...itemIssues);
    } else {
      valid.push(item);
    }
  });

  return { valid, invalid, issues };
}
