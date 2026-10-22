"use client";

import { useEffect, useId, useRef, useState } from "react";
import { initials } from "@/lib/workspace/contact-display";
import { MenuButton, MenuLink } from "./MenuButton";
import styles from "./landing-account.module.css";

type LandingAccountIdentity = {
  displayName: string | null;
  email: string | null;
};

export function LandingAccountPending() {
  return <MenuButton tone="navy" className={styles.signIn} disabled aria-label="Checking your account">Account</MenuButton>;
}

export function LandingAccountMenu({ account }: { account: LandingAccountIdentity | null }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [open]);

  if (!account) {
    return <MenuLink href="/login?next=/dashboard" tone="navy" className={styles.signIn}>Sign in</MenuLink>;
  }

  const name = account.displayName?.trim() || account.email || "Your account";
  const shortName = account.displayName?.trim().split(/\s+/u)[0] || "Account";
  return <div className={styles.profile} ref={panel} onKeyDown={event => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    trigger.current?.focus();
  }}>
    <MenuButton ref={trigger} className={styles.trigger}
      aria-label={`Account menu for ${name}`} aria-expanded={open}
      aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}>
      <span className={styles.avatar} aria-hidden="true">{initials(name).toUpperCase()}</span>
      <span className={styles.name}>{shortName}</span>
    </MenuButton>
    {open && <div id={menuId} className={styles.menu} role="group" aria-label="Your account">
      <div className={styles.identity}><strong>{name}</strong>{account.email && <span>{account.email}</span>}</div>
      <MenuLink href="/dashboard" tone="navy" className={styles.action}>Open dashboard</MenuLink>
      <MenuLink href="/dashboard/settings" className={styles.action}>Account settings</MenuLink>
      <form action="/api/auth/logout" method="post">
        <MenuButton type="submit" className={`${styles.action} ${styles.signOut}`}>Sign out</MenuButton>
      </form>
    </div>}
  </div>;
}

