"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type WorldInspectorSelectOption<T extends string | number> = {
  value: T;
  label: string;
};

type WorldInspectorSelectProps<T extends string | number> = {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
  options: readonly WorldInspectorSelectOption<T>[];
  value: T;
};

function nextIndex(current: number, length: number, direction: 1 | -1): number {
  if (length === 0) return 0;
  return (current + direction + length) % length;
}

export function WorldInspectorSelect<T extends string | number>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: WorldInspectorSelectProps<T>) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(":", "");
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  const focusTrigger = () => {
    triggerRef.current?.focus();
  };

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) focusTrigger();
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close(true);
  };

  const openMenu = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const focusMenu = () => menuRef.current?.focus({ preventScroll: true });
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusMenu);
    } else {
      focusMenu();
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        focusTrigger();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [open]);

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu(event.key === "ArrowDown"
        ? nextIndex(selectedIndex, options.length, 1)
        : event.key === "ArrowUp"
          ? nextIndex(selectedIndex, options.length, -1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? Math.max(0, options.length - 1)
              : selectedIndex);
    }
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => nextIndex(index, options.length, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : Math.max(0, options.length - 1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(activeIndex);
      return;
    }
    if (event.key === "Tab") close();
  };

  return (
    <span className="cg-inspector-select" data-open={open ? "true" : "false"} ref={rootRef}>
      <button
        aria-controls={`${id}-menu`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${ariaLabel}：${selectedOption?.label ?? "无可选项"}`}
        className="cg-inspector-select__trigger"
        disabled={disabled || options.length === 0}
        onClick={() => {
          if (disabled || options.length === 0) return;
          if (open) close();
          else openMenu(selectedIndex);
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span>{selectedOption?.label ?? "无可选项"}</span>
      </button>
      {open && options.length > 0 && (
        <div
          aria-activedescendant={`${id}-option-${activeIndex}`}
          aria-label={ariaLabel}
          className="cg-inspector-select__menu"
          id={`${id}-menu`}
          onKeyDown={handleMenuKeyDown}
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <div
              aria-selected={option.value === value}
              className="cg-inspector-select__option"
              data-active={index === activeIndex ? "true" : "false"}
              id={`${id}-option-${index}`}
              key={String(option.value)}
              onClick={() => selectOption(index)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              tabIndex={-1}
            >
              <span aria-hidden="true" className="cg-inspector-select__option-mark">{option.value === value ? "✓" : ""}</span>
              <span>{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
