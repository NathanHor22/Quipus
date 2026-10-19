"use client";

import { useCallback, useState } from "react";
import { useBrowserStorageSnapshot } from "@/components/hooks/useBrowserStorageSnapshot";
import { notifyBrowserStorage } from "@/lib/browser/storage";
import type { WorkspaceMode } from "@/lib/workspace/model";

export type WorkspaceIntroductionStep = 0 | 1 | 2;

const INTRODUCTION_EVENT = "quipus:workspace-introduction";

type IntroductionOptions = {
  mode: WorkspaceMode;
  accountId: string | null;
  /** Gates the first automatic opening only; route changes do not close an active tour. */
  ready: boolean;
  completedAt?: string | null;
  /** Persist the timestamp to the authenticated account; local storage is the fallback. */
  onComplete?: (completedAt: string) => void | Promise<void>;
};

type IntroductionState = {
  identity: string;
  considered: boolean;
  step: WorkspaceIntroductionStep | null;
};

export function useWorkspaceIntroduction({
  mode,
  accountId,
  ready,
  completedAt,
  onComplete,
}: IntroductionOptions) {
  const identity = mode === "sample" ? "sample" : `account:${accountId || "pending"}`;
  const storageKey = mode === "sample" || accountId
    ? `quipus:workspace-introduction:v1:${identity}`
    : null;
  const storedCompletion = useBrowserStorageSnapshot(storageKey, { eventName: INTRODUCTION_EVENT });
  const [state, setState] = useState<IntroductionState>({ identity, considered: false, step: null });

  // Conditional render updates reconcile hydration/account changes without opening on every route.
  // A null storage snapshot is the server/hydration state; an empty string means unseen.
  if (state.identity !== identity) {
    setState({ identity, considered: false, step: null });
  } else if (!state.considered && ready && storageKey && storedCompletion !== null) {
    setState({ identity, considered: true, step: completedAt || storedCompletion ? null : 0 });
  }

  const finish = useCallback(() => {
    const timestamp = new Date().toISOString();
    setState({ identity, considered: true, step: null });
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, timestamp);
        notifyBrowserStorage(INTRODUCTION_EVENT);
      } catch {
        // The introduction remains dismissed in memory if browser storage is blocked.
      }
    }
    if (mode === "live" && accountId && onComplete) {
      // Persistence must never keep a user trapped in onboarding.
      void Promise.resolve().then(() => onComplete(timestamp)).catch(() => {});
    }
  }, [identity, storageKey, mode, accountId, onComplete]);

  const start = useCallback(() => {
    setState({ identity, considered: true, step: 0 });
  }, [identity]);

  const next = useCallback(() => {
    if (state.step === 2) {
      finish();
    } else if (state.step !== null) {
      setState({ identity, considered: true, step: (state.step + 1) as WorkspaceIntroductionStep });
    }
  }, [state.step, identity, finish]);

  return { step: state.identity === identity ? state.step : null, start, next, dismiss: finish };
}
