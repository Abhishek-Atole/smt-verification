"use client";

interface ScanInputProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}

export function ScanInput({
  label,
  placeholder,
  value,
  onChange,
  onKeyDown,
  inputRef,
  disabled,
}: ScanInputProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="rounded-md border border-neutral-300 px-3 py-2 outline-none ring-neutral-300 focus:ring"
      />
    </label>
  );
}
