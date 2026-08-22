"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import * as React from "react"

import { cn } from "@/lib/utils"

function Slider<Value extends number | readonly number[]>({ className, thumbAriaLabel, ...props }: SliderPrimitive.Root.Props<Value> & { thumbAriaLabel?: string }) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("relative flex min-h-11 w-full touch-none select-none items-center", className)} {...props}>
      <SliderPrimitive.Control className="flex w-full items-center">
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-input">
          <SliderPrimitive.Indicator className="absolute h-full bg-primary" />
          <SliderPrimitive.Thumb aria-label={thumbAriaLabel} className="block size-5 rounded-full border-2 border-primary bg-background shadow-sm outline-none transition-[transform,box-shadow] duration-150 before:absolute before:-inset-3 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[.96] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
