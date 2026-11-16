import type { ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

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
    <RadioGroup className="segmented" aria-label={label} value={value} onValueChange={onValue}>
      {options.map(([option, text]) => (
        <Radio.Root key={option} value={option} render={<button type="button" />}>
          {text}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
