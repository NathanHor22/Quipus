"use client";

import Link from "next/link";
import type { ComponentProps, ComponentPropsWithRef } from "react";
import styles from "./menu-button.module.css";

type MenuStyleProps = {
  tone?: "light" | "navy" | "red";
  selected?: boolean;
};

function buttonClass(tone: NonNullable<MenuStyleProps["tone"]>, selected: boolean | undefined, extra?: string) {
  return [styles.button, styles[tone], selected ? styles.selected : "", extra].filter(Boolean).join(" ");
}

export function MenuButton({
  tone = "light", selected, className, children, type = "button", ...props
}: ComponentPropsWithRef<"button"> & MenuStyleProps) {
  return <button {...props} type={type} className={buttonClass(tone, selected, className)}>
    <span className={styles.content}>{children}</span>
  </button>;
}

export function MenuLink({
  tone = "light", selected, className, children, ...props
}: ComponentProps<typeof Link> & MenuStyleProps) {
  return <Link {...props} className={buttonClass(tone, selected, className)}>
    <span className={styles.content}>{children}</span>
  </Link>;
}
