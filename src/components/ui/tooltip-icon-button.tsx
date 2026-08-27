"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import {
  forwardRef,
  type ButtonHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

export interface TooltipIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  side?: "top" | "right" | "bottom" | "left";
  tooltip: string;
}

export const TooltipIconButton = forwardRef<HTMLButtonElement, TooltipIconButtonProps>(
  ({ children, className, side = "bottom", tooltip, ...props }, ref) => (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            {...props}
            aria-label={props["aria-label"] ?? tooltip}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,scale] duration-150 hover:bg-accent hover:text-foreground active:scale-96 disabled:pointer-events-none disabled:opacity-40",
              className,
            )}
            ref={ref}
            type={props.type ?? "button"}
          >
            {children}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="cg-tooltip z-70 rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground"
            side={side}
            sideOffset={6}
          >
            {tooltip}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  ),
);

TooltipIconButton.displayName = "TooltipIconButton";
