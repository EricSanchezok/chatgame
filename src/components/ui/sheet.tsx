"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Sheet = Dialog.Root;

export function SheetContent({
  children,
  className,
  ...props
}: ComponentProps<typeof Dialog.Content> & { children: ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
      <Dialog.Content
        {...props}
        className={cn(
          "cg-sheet-surface fixed inset-x-0 bottom-0 z-60 max-h-[min(80dvh,42rem)] overflow-y-auto overscroll-contain rounded-t-3xl border-t bg-popover px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-popover-foreground data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom motion-reduce:animate-none",
          className,
        )}
      >
        <div aria-hidden="true" className="mx-auto mb-5 h-1 w-10 rounded-full bg-border" />
        {children}
        <Dialog.Close
          aria-label="关闭游戏控制"
          className="absolute end-4 top-4 inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,scale] duration-150 hover:bg-accent hover:text-foreground active:scale-96"
        >
          <X aria-hidden="true" className="size-4" />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title {...props} className={cn("text-lg font-semibold", className)} />;
}

export function SheetDescription({ className, ...props }: ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      {...props}
      className={cn("mt-1 text-sm leading-6 text-muted-foreground", className)}
    />
  );
}
