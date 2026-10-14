"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

type DialogProps = Omit<
  ComponentPropsWithoutRef<"dialog">,
  "open" | "onCancel" | "onClose"
> & {
  open: boolean;
  onClose: () => void;
  dismissDisabled?: boolean;
};

/** A controlled native dialog. The browser owns modal focus and focus restoration. */
export function Dialog({ open, onClose, dismissDisabled = false, ...props }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    const element = dialog.current;
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  return (
    <dialog
      {...props}
      ref={dialog}
      onCancel={event => {
        // React controls dismissal; saving dialogs cannot be escaped midway through a request.
        event.preventDefault();
        if (!dismissDisabled) onClose();
      }}
      onClose={event => {
        // Ignore a controlled close or an old close event after the dialog has reopened.
        if (open && !event.currentTarget.open) onClose();
      }}
    />
  );
}
