"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function WorkspaceDialog({
  children,
  closeLabel,
  description,
  eyebrow,
  onOpenChange,
  open,
  title,
}: {
  children: ReactNode;
  closeLabel?: string;
  description: string;
  eyebrow: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="cg-workspace__overlay" />
        <Dialog.Content
          className="cg-workspace"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>("[data-cg-orb-trigger]")?.focus();
          }}
        >
          <header className="cg-workspace__header">
            <div className="cg-workspace__heading">
              <span className="cg-workspace__eyebrow">{eyebrow}</span>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close aria-label={closeLabel ?? `关闭${title}`} className="cg-workspace__close">
              <X aria-hidden="true" />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
