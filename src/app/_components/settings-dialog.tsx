"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Settings, X } from "lucide-react";
import { SettingsPanel } from "./settings-panel";

export function SettingsDialog() {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="cg-launcher__action" type="button">
        <Settings aria-hidden="true" />
        <span>
          <strong>设置</strong>
          <small>外观、文字大小与动态效果</small>
        </span>
        <ArrowRight aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="cg-modal-overlay" />
        <Dialog.Content
          aria-describedby="settings-dialog-description"
          className="cg-modal-surface cg-settings-dialog"
        >
          <header className="cg-settings-dialog__header">
            <p className="cg-eyebrow">本机偏好</p>
            <Dialog.Title>设置</Dialog.Title>
            <Dialog.Description id="settings-dialog-description">
              调整外观、文字和动态效果。所有偏好只保存在这台设备上。
            </Dialog.Description>
          </header>
          <div className="cg-modal-scroll cg-settings-dialog__content">
            <SettingsPanel />
          </div>
          <Dialog.Close aria-label="关闭设置" className="cg-modal-close">
            <X aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
