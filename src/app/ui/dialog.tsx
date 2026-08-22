"use client";

import type { ReactNode } from "react";
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function Dialog({
  title,
  description,
  onClose,
  children,
  className,
}: {
  title: string;
  description?: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={`cg-dialog${className ? ` ${className}` : ""}`} closeLabel={`关闭${title}`} aria-label={title}>
        <DialogHeader className="cg-dialog__header">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="cg-dialog__body">{children}</div>
      </DialogContent>
    </DialogRoot>
  );
}
