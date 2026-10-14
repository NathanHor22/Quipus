"use client";

import { useRef, useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase/client";

import styles from "./login.module.css";

type LoginButtonProps = {
  nextPath: string;
};

export function LoginButton({ nextPath }: LoginButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);

  async function signIn() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);

    try {
      const supabase = getBrowserSupabase();
      if (!supabase) {
        setError("Sign-in is unavailable right now. Please try again shortly.");
        pending.current = false;
        setLoading(false);
        return;
      }

      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", nextPath);
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback.toString(),
          queryParams: { prompt: "select_account" },
        },
      });

      if (signInError) throw signInError;
    } catch {
      setError("Google sign-in could not be started. Please try again.");
      pending.current = false;
      setLoading(false);
    }
  }

  return (
    <>
      <button
        className={styles.googleButton}
        disabled={loading}
        aria-busy={loading}
        onClick={signIn}
        type="button"
      >
        <svg className={styles.googleMark} aria-hidden="true" viewBox="0 0 48 48" focusable="false">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.88 46.98 24.55Z" />
          <path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.7 23.7 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
        </svg>
        <span aria-live="polite">{loading ? "Opening Google..." : "Continue with Google"}</span>
      </button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </>
  );
}
