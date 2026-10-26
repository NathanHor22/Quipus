import type { ReactNode } from "react";
import styles from "./settings-section.module.css";

type SettingsSectionProps = {
  title: string;
  children: ReactNode;
  id?: string;
  /** Display-only connection state; actions belong inside the expanded section. */
  status?: ReactNode;
  defaultOpen?: boolean;
};

/** Native disclosure retains form drafts and device state while its content is collapsed. */
export function SettingsSection({ title, children, id, status, defaultOpen = false }: SettingsSectionProps) {
  return <details id={id} className={styles.section} name="quipus-settings" open={defaultOpen || undefined}>
    <summary className={styles.summary}>
      <h2 className={styles.heading}>
        <span className={styles.title}>{title}</span>
        {status != null && <span className={styles.status}>{status}</span>}
        <span className={styles.chevron} aria-hidden="true" />
      </h2>
    </summary>
    <div className={styles.content}>{children}</div>
  </details>;
}
