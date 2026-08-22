import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const frameVariants = cva("cg-frame", {
  variants: {
    variant: {
      default: "cg-frame--default",
      inverse: "cg-frame--inverse",
      ghost: "cg-frame--ghost",
    },
    spacing: {
      sm: "cg-frame--sm",
      default: "cg-frame--md",
      lg: "cg-frame--lg",
    },
  },
  defaultVariants: { variant: "default", spacing: "default" },
});

function Frame({ className, variant, spacing, ...props }: ComponentProps<"div"> & VariantProps<typeof frameVariants>) {
  return <div data-slot="frame" className={cn(frameVariants({ variant, spacing }), className)} {...props} />;
}

function FramePanel({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="frame-panel" className={cn("cg-frame-panel", className)} {...props} />;
}

function FrameHeader({ className, ...props }: ComponentProps<"header">) {
  return <header data-slot="frame-header" className={cn("cg-frame-header", className)} {...props} />;
}

function FrameTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="frame-title" className={cn("cg-frame-title", className)} {...props} />;
}

function FrameDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="frame-description" className={cn("cg-frame-description", className)} {...props} />;
}

function FrameFooter({ className, ...props }: ComponentProps<"footer">) {
  return <footer data-slot="frame-footer" className={cn("cg-frame-footer", className)} {...props} />;
}

export { Frame, FramePanel, FrameHeader, FrameTitle, FrameDescription, FrameFooter, frameVariants };
