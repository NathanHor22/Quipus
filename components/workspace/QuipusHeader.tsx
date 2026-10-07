"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { QuipusMark } from "@/components/brand/QuipusMark";
import { useQuipusMotion } from "@/components/experience/QuipusExperience";
import type { WorkspaceAccount, WorkspaceView } from "./Workspace";
import { initials } from "./ConversationPanel";
import styles from "./quipus.module.css";

export const viewPaths: Record<WorkspaceView, string> = {
  overview: "/dashboard", conversations: "/dashboard/conversations", calendar: "/dashboard/calendar",
  people: "/dashboard/people", device: "/dashboard/devices", settings: "/dashboard/settings",
};
export function QuipusHeader({ view, sample, account, navigate }: {
  view: WorkspaceView; sample: boolean; account: WorkspaceAccount | null;
  navigate: (view: WorkspaceView) => void;
}) {
  const { enabled } = useQuipusMotion();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menu.current?.querySelector("button")?.focus(); } };
    if (open) { document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape); }
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const name = account?.displayName || account?.email || "Your account";
  return <header className={styles.header}>
    <Link href={sample ? "/" : "/dashboard"} className={styles.brand} aria-label="Quipus home"><QuipusMark /><span>QUIPUS</span></Link>
    <nav className={styles.navigation} aria-label="Main navigation">
      {([{ id: "overview", label: "Home" }, { id: "conversations", label: "Conversations" },
        { id: "calendar", label: "Calendar" }, { id: "device", label: "Devices" }] as const).map(({ id, label }) =>
        <Link key={id} href={sample ? `/?mode=sample&view=${id}` : viewPaths[id]} aria-current={view === id ? "page" : undefined}
          className={`${styles.navLink} ${view === id ? styles.navSelected : ""}`}
          onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); navigate(id); } }}>
          {view === id && <motion.span className={styles.navHighlight} layoutId="quipus-active-tab" transition={{ duration: enabled ? .12 : 0, ease: "easeOut" }} />}
          <span>{label}</span>
        </Link>)}
    </nav>
    <div className={styles.headerActions}>
      {account ? <div className={styles.profile} ref={menu}>
        <button className={styles.profileTrigger} aria-expanded={open} aria-controls="quipus-profile-menu" onClick={() => setOpen(!open)}>
          <span className={styles.profileAvatar}>{initials(name)}</span><span>{name.split(" ")[0]}</span><span className={styles.profileCaret} aria-hidden="true" />
        </button>
        {open && <div className={styles.profileMenu} id="quipus-profile-menu">
          <strong>{name}</strong><small>{account.email}</small>
          {sample && <Link href="/dashboard">Open my workspace</Link>}
          <button onClick={() => { setOpen(false); navigate("people"); }}>People & companies</button>
          <button onClick={() => { setOpen(false); navigate("settings"); }}>Account & settings</button>
          <form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form>
        </div>}
      </div> : <Link className={styles.signIn} href="/login?next=/dashboard">Sign in <span>with Google</span></Link>}
    </div>
  </header>;
}
