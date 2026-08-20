"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose(): void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const reduce = document.documentElement.dataset.cgMotionPreference === "reduce"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), reduce ? 0 : 220);
  }, []);

  useEffect(() => {
    const node = document.createElement("div");
    node.dataset.cgDialogPortal = "";
    document.body.appendChild(node);
    // A portal target is a browser resource and cannot exist during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortal(node);
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      node.remove();
    };
  }, []);

  useEffect(() => {
    if (!portal) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = [...document.body.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== portal)
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
    for (const { element } of siblings) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    const frame = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")
        ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      for (const { element, inert, ariaHidden } of siblings) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      restoreRef.current?.focus();
    };
  }, [portal, requestClose]);

  if (!portal) return null;
  return createPortal(
    <div
      className={`cg-dialog-layer${closing ? " cg-dialog-layer--closing" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className="cg-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="cg-dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button type="button" className="cg-button cg-button--quiet" onClick={requestClose} aria-label={`关闭${title}`}>
            关闭
          </button>
        </header>
        <div className="cg-dialog__body">{children}</div>
      </div>
    </div>,
    portal,
  );
}
