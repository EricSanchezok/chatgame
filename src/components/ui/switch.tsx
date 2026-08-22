"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import * as React from "react"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary before:absolute before:-inset-x-1 before:-inset-y-2",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 translate-x-1 rounded-full bg-background shadow-sm transition-transform duration-150 data-[checked]:translate-x-6 motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
