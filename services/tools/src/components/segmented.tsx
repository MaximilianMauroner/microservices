import type { ReactNode } from "react";

/** A single choice from a few options, such as a time range or a list filter. Shared by every tool. */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onValue,
}: {
  label: string;
  options: readonly (readonly [Value, ReactNode])[];
  value: Value;
  onValue: (value: Value) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} type="button" aria-pressed={option === value} onClick={() => onValue(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}
