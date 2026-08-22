"use client";

import type { ComponentProps, ReactNode } from "react";
import { Badge as ReuiBadge } from "@/components/ui/badge";
import { Button as ReuiButton } from "@/components/ui/button";
import { Checkbox as ReuiCheckbox } from "@/components/ui/checkbox";
import { Input as ReuiInput } from "@/components/ui/input";
import { InputGroup as ReuiInputGroup } from "@/components/ui/input-group";
import {
  Select as ReuiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider as ReuiSlider } from "@/components/ui/slider";
import { Switch as ReuiSwitch } from "@/components/ui/switch";
import { Textarea as ReuiTextarea } from "@/components/ui/textarea";
import { Frame, FramePanel } from "@/components/reui/frame";
import { cn } from "@/lib/utils";
import { SCRIPT_UI_API_VERSION } from "./client-dto";

export { SCRIPT_UI_API_VERSION, Frame, FramePanel };

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ControlSize = "sm" | "md" | "lg" | "icon";

const buttonVariants = {
  primary: "default",
  secondary: "outline",
  quiet: "ghost",
  danger: "destructive",
} as const;

const buttonSizes = {
  sm: "sm",
  md: "default",
  lg: "lg",
  icon: "icon",
} as const;

export function Button({
  variant = "secondary",
  size = "md",
  ...props
}: Omit<ComponentProps<typeof ReuiButton>, "variant" | "size"> & {
  variant?: ButtonVariant;
  size?: ControlSize;
}) {
  return <ReuiButton variant={buttonVariants[variant]} size={buttonSizes[size]} {...props} />;
}

export function Badge({
  tone = "neutral",
  ...props
}: Omit<ComponentProps<typeof ReuiBadge>, "variant"> & {
  tone?: "neutral" | "accent" | "danger" | "outline";
}) {
  const variant = tone === "accent" ? "default" : tone === "danger" ? "destructive" : tone === "outline" ? "outline" : "secondary";
  return <ReuiBadge variant={variant} {...props} />;
}

export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return <ReuiInputGroup className={cn("cg-input-group", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<typeof ReuiTextarea>) {
  return <ReuiTextarea className={cn("cg-textarea", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<typeof ReuiInput>) {
  return <ReuiInput className={cn("cg-input", className)} {...props} />;
}

export interface SelectOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "请选择",
  disabled,
  className,
  id,
}: {
  value: string;
  onValueChange(value: string): void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <ReuiSelect<string> items={options.map((option) => ({ value: option.value, label: option.label }))} value={value} onValueChange={(next) => { if (next !== null) onValueChange(next); }} disabled={disabled}>
      <SelectTrigger id={id} className={cn("cg-select", className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            <span className="cg-select-option"><span>{option.label}</span>{option.description ? <small>{option.description}</small> : null}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </ReuiSelect>
  );
}

export function Switch({ checked, onCheckedChange, className, ...props }: Omit<ComponentProps<typeof ReuiSwitch>, "onCheckedChange"> & { checked: boolean; onCheckedChange(checked: boolean): void }) {
  return <ReuiSwitch checked={checked} onCheckedChange={(next) => onCheckedChange(next)} className={cn("cg-switch-control", className)} {...props} />;
}

export function Checkbox({ checked, onCheckedChange, className, ...props }: Omit<ComponentProps<typeof ReuiCheckbox>, "onCheckedChange"> & { checked: boolean; onCheckedChange(checked: boolean): void }) {
  return <ReuiCheckbox checked={checked} onCheckedChange={(next) => onCheckedChange(next)} className={cn("cg-checkbox-control", className)} {...props} />;
}

export function Slider({
  value,
  onValueChange,
  className,
  "aria-label": ariaLabel,
  ...props
}: Omit<ComponentProps<"div">, "defaultValue" | "onChange"> & {
  value: number;
  onValueChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <ReuiSlider<number>
      value={value}
      onValueChange={(next) => onValueChange(next)}
      thumbAriaLabel={ariaLabel}
      className={cn("cg-slider", className)}
      {...props}
    />
  );
}

export function SettingRow({
  controlId,
  label,
  description,
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  controlId?: string;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div data-slot="setting-row" className={cn("cg-setting-row", className)} {...props}>
      <div className="cg-setting-row__copy">
        {controlId ? <label htmlFor={controlId}>{label}</label> : <strong>{label}</strong>}
        {description ? <p>{description}</p> : null}
      </div>
      <div className="cg-setting-row__control">{children}</div>
    </div>
  );
}
