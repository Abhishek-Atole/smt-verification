import { useCallback, useEffect, useRef } from "react";

interface UseAutoScanOptions {
  onScan: (value: string) => void | Promise<void>;
  delayMs?: number;
  minLength?: number;
  enabled?: boolean;
}

export function useAutoScan(
  value: string,
  { onScan, delayMs = 300, minLength = 3, enabled = true }: UseAutoScanOptions,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValueRef = useRef("");
  const onScanRef = useRef(onScan);
  const inFlightRef = useRef(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    lastValueRef.current = "";
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }

    const normalizedValue = value.trim();
    if (normalizedValue.length < minLength || normalizedValue === lastValueRef.current) {
      reset();
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      if (inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      lastValueRef.current = normalizedValue;

      try {
        void Promise.resolve(onScanRef.current(normalizedValue)).finally(() => {
          inFlightRef.current = false;
        });
      } catch {
        inFlightRef.current = false;
      }
    }, delayMs);

    return reset;
  }, [delayMs, enabled, minLength, reset, value]);

  return { reset };
}