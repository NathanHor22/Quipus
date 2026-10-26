"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { WorkspaceIntroductionStep } from "./useWorkspaceIntroduction";
import styles from "./introduction.module.css";

const steps = [
  { target: "approvals", title: "Approve what happens next", description: "Check follow-ups before anything is scheduled or shared." },
  { target: "calendar", title: "Find your meetings", description: "Choose a date to open the conversation, recording and follow-up." },
  { target: "people", title: "Keep your connections close", description: "Open a person’s card to see your shared conversation history." },
] as const;

type Bounds = { top: number; left: number; width: number; height: number; viewportWidth: number; viewportHeight: number };

type WorkspaceIntroductionProps = {
  step: WorkspaceIntroductionStep | null;
  onNext: () => void;
  onDismiss: () => void;
};

/** A short, non-mutating introduction. Native dialog keeps background actions out of reach. */
export function WorkspaceIntroduction(props: WorkspaceIntroductionProps) {
  return props.step === null ? null : <IntroductionDialog {...props} step={props.step} />;
}

function IntroductionDialog({ step, onNext, onDismiss }: WorkspaceIntroductionProps & { step: WorkspaceIntroductionStep }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [cardHeight, setCardHeight] = useState(248);
  const titleId = useId();
  const descriptionId = useId();
  const current = steps[step];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.close();
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active !== document.body && !dialog.contains(active)) return;
        const restoreTarget = opener?.isConnected && opener !== document.body
          ? opener
          : document.getElementById("main-content");
        restoreTarget?.focus({ preventScroll: true });
      });
    };
  }, []);

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
    let frame = 0;
    let revealedTarget: Element | null = null;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(`[data-workspace-intro="${steps[step].target}"]`);
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        if (!target) {
          setBounds(null);
          return;
        }
        let rect = target.getBoundingClientRect();
        if (revealedTarget !== target) {
          revealedTarget = target;
          if (rect.bottom < 80 || rect.top > viewportHeight - 240) {
            target.scrollIntoView({ block: "center", behavior: "instant" });
            rect = target.getBoundingClientRect();
          }
        }
        const left = Math.max(10, rect.left - 6);
        const top = Math.max(10, rect.top - 6);
        const width = Math.max(0, Math.min(viewportWidth - 10, rect.right + 6) - left);
        const height = Math.max(0, Math.min(viewportHeight - 10, rect.bottom + 6) - top);
        const nextBounds = { top, left, width, height, viewportWidth, viewportHeight };
        setBounds(previous => previous && Object.keys(nextBounds).every(key => previous[key as keyof Bounds] === nextBounds[key as keyof Bounds]) ? previous : nextBounds);
        if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
      });
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.getElementById("main-content") || document.body, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(measure);
    if (cardRef.current) resizeObserver.observe(cardRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const settle = window.setTimeout(measure, 240);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  const compact = bounds && bounds.viewportWidth < 680;
  let cardStyle: CSSProperties | undefined;
  if (bounds) {
    const margin = 18;
    const width = Math.min(360, bounds.viewportWidth - margin * 2);
    let top = bounds.top + bounds.height + 16;
    let left = Math.min(bounds.left, bounds.viewportWidth - width - margin);
    if (compact) {
      top = Math.max(margin, bounds.viewportHeight - cardHeight - margin);
      left = margin;
    } else if (top + cardHeight > bounds.viewportHeight - margin) {
      if (bounds.top - cardHeight - 16 >= margin) top = bounds.top - cardHeight - 16;
      else {
        top = Math.max(margin, Math.min(bounds.top + 16, bounds.viewportHeight - cardHeight - margin));
        if (bounds.left + bounds.width + width + 34 <= bounds.viewportWidth) left = bounds.left + bounds.width + 16;
        else if (bounds.left - width - 16 >= margin) left = bounds.left - width - 16;
      }
    }
    cardStyle = { top, left: Math.max(margin, left), width };
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); onDismiss(); }}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {bounds && bounds.width > 0 && bounds.height > 0 && <div className={styles.highlight} aria-hidden="true" style={{ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height }} />}
      <div ref={cardRef} className={styles.card} style={cardStyle}>
        <header className={styles.header}>
          <span className={styles.kicker}>A quick introduction</span>
          <span className={styles.progress} aria-label={`Step ${step + 1} of ${steps.length}`}>{step + 1} / {steps.length}</span>
        </header>
        <div key={step} className={styles.copy} aria-live="polite" aria-atomic="true">
          <h2 id={titleId}>{current.title}</h2>
          <p id={descriptionId}>{current.description}</p>
        </div>
        <footer className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onDismiss}>Skip</button>
          <button ref={nextRef} type="button" className={styles.primary} onClick={onNext}>{step === 2 ? "Done" : "Next"}</button>
        </footer>
      </div>
    </dialog>
  );
}
