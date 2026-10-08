import Link from "next/link";

import { QuipusLogo } from "@/components/brand/QuipusLogo";
import { RevealHeading } from "@/components/experience/QuipusExperience";
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
      <div className={styles.authShell}>
        <Link href="/?mode=sample" className={styles.brandLockup} aria-label="Explore Quipus">
          <QuipusLogo className={styles.logo} />
        </Link>
        <section className={styles.card} aria-labelledby="login-title">
          <p className={styles.cardKicker}>WELCOME TO QUIPUS</p>
          <RevealHeading
            as="h1"
            text="Your conversations. Your next move."
            className={styles.heading}
          />
          <p className={styles.description}>
            Record meetings. Review the details. Follow up.
          </p>
          <h2 id="login-title" className={styles.signInTitle}>Sign in to your workspace</h2>

          {message ? <p className={styles.notice} role="alert">{message}</p> : null}

          {configured ? (
            <LoginButton nextPath={nextPath} />
          ) : (
            <div className={styles.localNotice}>
              <strong>Sign-in is unavailable right now.</strong>
              <span>You can explore the sample workspace.</span>
              <Link href="/?mode=sample">Explore a sample workspace</Link>
            </div>
          )}

          <p className={styles.footnote}>
            Your meetings stay private. You approve every follow-up.
          </p>

          {configured && <div className={styles.demoSection}>
            <span>Take a look around first.</span>
            <Link href="/?mode=sample">Explore a sample workspace</Link>
          </div>}

          <p className={styles.legalLinks}>
            <Link href="/privacy">Privacy</Link><span aria-hidden="true">·</span><Link href="/terms">Terms</Link>
          </p>
        </section>
      </div>
      <p className={styles.pageFooter}>Your partner in sales and business development.</p>
    </main>
  );
}
