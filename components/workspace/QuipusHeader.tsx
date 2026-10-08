"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { QuipusMark } from "@/components/brand/QuipusMark";
import { useQuipusMotion } from "@/components/experience/QuipusExperience";
import type { WorkspaceAccount, WorkspaceView } from "./Workspace";
import { workspaceViewPaths } from "@/lib/workspace-navigation";
import { initials } from "./ConversationPanel";
import styles from "./quipus.module.css";

export const viewPaths = workspaceViewPaths;

export function QuipusHeader({ view, sample, account, navigate }: {
  view: WorkspaceView; sample: boolean; account: WorkspaceAccount | null;
  navigate: (view: WorkspaceView) => void;
}) {
  const { enabled } = useQuipusMotion();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [view, account?.email]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    if (open) { document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape); }
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const name = account?.displayName?.trim() || account?.email || "Your account";
  const givenName = account?.displayName?.trim().split(/\s+/u)[0];
  const switchView = (event: MouseEvent<HTMLAnchorElement>, next: WorkspaceView) => {
    if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault(); navigate(next);
    }
  };
  return <header className={styles.header}>
    <a href={sample ? "/?mode=sample&view=overview" : "/dashboard"} className={styles.brand} aria-label="Quipus home" onClick={event => switchView(event, "overview")}><QuipusMark /><span>QUIPUS</span></a>
    <nav className={styles.navigation} aria-label="Main navigation">
      {([{ id: "overview", label: "Home" }, { id: "conversations", label: "Conversations" },
        { id: "calendar", label: "Calendar" }, { id: "device", label: "Devices" }, { id: "settings", label: "Settings" }] as const).map(({ id, label }) =>
        <a key={id} href={sample ? `/?mode=sample&view=${id}` : viewPaths[id]} aria-current={view === id ? "page" : undefined}
          className={`${styles.navLink} ${view === id ? styles.navSelected : ""}`}
          onClick={event => switchView(event, id)}>
          {view === id && <motion.span className={styles.navHighlight} layoutId="quipus-active-tab" transition={{ duration: enabled ? .24 : 0, ease: [0.2, 0.8, 0.2, 1] }} />}
          <span>{label}</span>
        </a>)}
    </nav>
    <div className={styles.headerActions}>
      {account ? <div className={styles.profile} ref={menu}>
        <button ref={trigger} className={styles.profileTrigger} aria-label={`Account menu for ${name}`} aria-expanded={open} aria-controls="quipus-profile-menu" onClick={() => setOpen(value => !value)}>
          <span className={styles.profileAvatar} aria-hidden="true">{initials(name)}</span>
          {givenName && <span className={styles.profileName}>{givenName}</span>}
          <span className={styles.profileLabel}>Account</span>
        </button>
        {open && <div className={styles.profileMenu} id="quipus-profile-menu" aria-label="Account actions">
          <strong>{name}</strong><small>{account.email}</small>
          {sample && <Link href="/dashboard">Open my workspace</Link>}
          <button onClick={() => { setOpen(false); navigate("people"); }}>People & companies</button>
          <button onClick={() => { setOpen(false); navigate("settings"); }}>Account settings</button>
          <form action="/api/auth/logout" method="post"><button className={styles.signOut} type="submit">Sign out</button></form>
        </div>}
      </div> : <Link className={styles.signIn} href="/login?next=/dashboard">Sign in <span>with Google</span></Link>}
    </div>
  </header>;
}
