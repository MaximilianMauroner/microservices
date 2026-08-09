import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select.js";

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type AppSelectProps = {
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
};

/**
 * A compact field-level composition of the installed shadcn Select parts.
 * Keeping this composition in one place prevents pages from falling back to
 * native selects while preserving normal form submission through `name`.
 */
export function AppSelect({
  name,
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = "Choose an option",
  required,
  disabled,
  "aria-label": ariaLabel,
  className
}: AppSelectProps) {
  return (
    <Select
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next ?? "")}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
