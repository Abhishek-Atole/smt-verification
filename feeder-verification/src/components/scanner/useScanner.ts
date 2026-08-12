"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseScannerOptions {
  onSubmit: (value: string) => Promise<"success" | "error">;
  refocusDelayMs?: number;
  disabled?: boolean;
}

export function useScanner({ onSubmit, refocusDelayMs = 10000, disabled = false }: UseScannerOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const refocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const focus = useCallback(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    focus();
    return () => {
      if (refocusTimer.current) clearTimeout(refocusTimer.current);
    };
  }, [focus]);

  const handleKeyDown = useCallback(
    async (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      const trimmed = value.trim();
      if (!trimmed || loading || disabled) return;

      setLoading(true);
      const result = await onSubmit(trimmed);
      setValue("");
      setLoading(false);

      if (result === "success") {
        focus();
      } else {
        playBuzzer();
        refocusTimer.current = setTimeout(focus, refocusDelayMs);
      }
    },
    [value, loading, disabled, onSubmit, focus, refocusDelayMs],
  );

  return { inputRef, value, setValue, handleKeyDown, loading };
}

function playBuzzer() {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "sawtooth";
    oscillator.frequency.value = 180;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.6);
  } catch {
    // Ignore audio errors in restricted environments.
  }
}
