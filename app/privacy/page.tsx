import type { Metadata } from "next";
import Link from "next/link";

import { LanternMark } from "@/components/brand/LanternMark";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy ? Quipus",
  description: "How Quipus handles account, recording and relationship information.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/">
          <span className={styles.mark}>
            <LanternMark />
          </span>
          Quipus
        </Link>
        <article className={styles.article}>
          <p className={styles.eyebrow}>PRIVACY</p>
          <h1>Privacy Policy</h1>
          <p className={styles.updated}>Effective 18 October 2026</p>
          <p>
            Quipus helps you remember conversations and review follow-ups. This policy explains the
            information handled when you sign in, pair a recorder, process a meeting, research a
            contact or connect Google Calendar. Tell participants about recording and obtain their
            agreement before capture.
          </p>

          <h2>Information Quipus handles</h2>
          <ul>
            <li>Your account identifier, email, display name and chosen time zone.</li>
            <li>
              Recordings, transcripts, summaries, participants, evidence and follow-up drafts.
            </li>
            <li>
              Professional profile candidates, confirmed contact details and private reminders you
              save.
            </li>
            <li>
              Calendar authorization tokens, granted scopes, account identity, availability and
              approved events.
            </li>
            <li>
              Device identifiers, firmware, battery and connection status, upload integrity and
              operational logs.
            </li>
          </ul>

          <h2>How information is used</h2>
          <p>
            Quipus authenticates you, separates your workspace, processes recordings, builds contact
            history and prepares actions for review. Public research is presented with sources and
            possible identity matches require confirmation. Private reminders are kept separately
            from shared meeting reports. Quipus does not sell personal information or use recordings
            for advertising.
          </p>

          <h2>Google user data</h2>
          <p>
            Calendar event access lets Quipus create meetings you approve. Free/busy access checks
            proposed times. Google account identity helps you see which Calendar account is
            connected. Credentials are encrypted before storage and tied to the Quipus account that
            granted access.
          </p>
          <p>
            Quipus&apos;s use and transfer of information received from Google APIs adheres to the
            Google API Services User Data Policy, including its Limited Use requirements.
          </p>

          <h2>Service providers and research</h2>
          <p>
            Supabase provides authentication, database and private file storage; Vercel hosts the
            website; Railway runs background services. Agora supports live audio and speech
            services, and OpenAI processes audio and meeting text. Redis, when configured, holds
            temporary queue signals, processing progress and selected cached results.
          </p>
          <p>
            Exa researches public company and LinkedIn information using relevant names and company
            context. It does not receive the recording, full transcript, contact email or private
            reminders. Optional venue research uses the area, meeting preferences and budget you
            submit. Public indexing may be incomplete or outdated. Google receives Calendar
            information needed for the features you request.
          </p>

          <h2>Recording security and retention</h2>
          <p>
            Cloud recordings use private storage and short-lived playback links. Access checks tie
            records to their owner. Supported firmware encrypts SD recordings; prototype hardware
            still requires additional physical security before production release. Authorized cloud
            processors need readable audio and text, so this is not end-to-end encryption. No system
            can guarantee freedom from a security incident.
          </p>
          <p>
            Cloud audio is scheduled for deletion 90 days after ingestion, including registered
            source tracks and derived replay files. Operational delays and separate provider backup
            retention may affect final removal. Transcripts and contact history have a separate
            lifecycle. A device keeps unverified local recordings for recovery until the complete
            cloud upload has passed integrity checks.
          </p>

          <h2>Your choices</h2>
          <p>
            You can decline Calendar access, disconnect it in Settings, or revoke access in your
            Google Account. Approving an invitation may share the event information with its
            recipients. Connecting an Android microphone requires phone permissions and does not
            itself start recording. To request access, correction, export or deletion, email{" "}
            <a href="mailto:nathanhor2001@gmail.com">nathanhor2001@gmail.com</a>.
          </p>

          <h2>Contact and changes</h2>
          <p>
            Send questions to the address above. Material changes will appear on this page with a
            new effective date.
          </p>
        </article>
        <footer className={styles.footer}>
          <Link href="/">Home</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/login?next=/dashboard">Sign in</Link>
        </footer>
      </div>
    </main>
  );
}
