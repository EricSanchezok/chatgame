"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { Check } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border border-input bg-background outline-none transition-[color,background-color,border-color,transform] duration-150 before:absolute before:-inset-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[.96] disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground motion-reduce:active:scale-100",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator><Check className="size-4" /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
