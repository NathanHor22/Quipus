import Link from "next/link";

import { QuipusLogo } from "@/components/brand/QuipusLogo";
import { sanitizeAuthReturnTo } from "@/lib/auth-policy";
import { publicSupabaseConfig } from "@/lib/supabase/session";

import { LoginButton } from "./LoginButton";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

const messages: Record<string, string> = {
  oauth: "Google sign-in did not complete. Please try again.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const nextPath = sanitizeAuthReturnTo(query.next);
  const { url, anonKey } = publicSupabaseConfig();
  const configured = Boolean(url && anonKey);
  const message = query.error ? messages[query.error] : null;

  return (
    <main className={styles.page}>
      <div className={styles.cityscape} aria-hidden="true">
        <div className={styles.cityGrid} />
        <div className={styles.buildings}>
          {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
        </div>
        <div className={styles.redTrail} />
      </div>

      <Link href="/" className={styles.backButton}>Back to city</Link>

      <div className={styles.authShell}>
        <section className={styles.card} aria-labelledby="login-title">
          <div className={styles.brandLockup}>
            <QuipusLogo className={styles.logo} />
          </div>
          <p className={styles.cardKicker}>YOUR WORKSPACE</p>
          <h1 id="login-title" className={styles.heading}>Welcome to Quipus</h1>
          <p className={styles.description}>Your next move starts here.</p>

          {message ? <p className={styles.notice} role="alert">{message}</p> : null}

          {configured ? (
            <LoginButton nextPath={nextPath} />
          ) : (
            <div className={styles.localNotice}>
              <strong>Sign-in is unavailable right now.</strong>
              <span>You can explore the sample workspace.</span>
              <Link href="/demo">Try the sample</Link>
            </div>
          )}

          <p className={styles.footnote}>
            Your meetings stay private.<br />You approve every follow-up.
          </p>

          {configured ? (
            <div className={styles.demoSection}>
              <Link href="/demo">Try the sample</Link>
            </div>
          ) : null}

          <div className={styles.legalLinks}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
