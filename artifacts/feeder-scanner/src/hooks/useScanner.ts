import { useCallback, useEffect, useRef, useState } from "react";

interface UseScannerOptions {
  onSubmit: (value: string) => void;
  onError?: (value: string) => void;
  autoFocus?: boolean;
  resetAfterMs?: number;
}

interface UseScannerResult {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  reset: () => void;
}

export const useScanner = ({
  onSubmit,
  onError,
  autoFocus = true,
  resetAfterMs = 10000,
}: UseScannerOptions): UseScannerResult => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    focusInput();
    const timer = setInterval(focusInput, 1200);
    return () => clearInterval(timer);
  }, [autoFocus, focusInput]);

  const reset = useCallback(() => {
    setValue("");
    requestAnimationFrame(() => focusInput());
  }, [focusInput]);

  const handleError = useCallback(
    (rawValue: string) => {
      onError?.(rawValue);
      window.setTimeout(() => {
        reset();
      }, resetAfterMs);
    },
    [onError, reset, resetAfterMs],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      const normalizedValue = value.trim();
      if (!normalizedValue) {
        return;
      }

      try {
        onSubmit(normalizedValue);
        reset();
      } catch (_error) {
        handleError(normalizedValue);
      }
    },
    [handleError, onSubmit, reset, value],
  );

  return {
    inputRef,
    value,
    setValue,
    handleKeyDown,
    reset,
  };
};
