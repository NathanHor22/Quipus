import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import type { WorkspaceMode } from "@/lib/workspace/model";
import { Workspace, type WorkspaceView } from "./Workspace";
import { getServerSupabase } from "@/lib/supabase/server";
import { validTimezone } from "@/lib/quipus-profile";
import { Suspense } from "react";
import styles from "./quipus.module.css";
import layout from "./dashboard.module.css";

type WorkspaceRouteProps = {
  mode: WorkspaceMode;
  view: WorkspaceView;
  conversationId?: string;
};

export function WorkspaceRoute(props: WorkspaceRouteProps) {
  return <Suspense fallback={
    <main className={layout.frame} aria-label="Opening workspace">
      <div className={styles.workspaceSkeleton} role="status" aria-live="polite">
        <span className={styles.skeletonLabel}>Opening Quipus…</span>
        <div className={styles.skeletonBrief} aria-hidden="true"><i /><i /></div>
        <div className={styles.skeletonRows} aria-hidden="true"><i /><i /><i /></div>
      </div>
    </main>
  }><WorkspaceContent {...props} /></Suspense>;
}

async function WorkspaceContent({ mode, view, conversationId }: WorkspaceRouteProps) {
  const user = await getAuthenticatedLanternUser();
  const profile = user ? await getServerSupabase()?.from("profiles").select("name,timezone").eq("id", user.id).maybeSingle() : null;
  const account = user?.email
    ? {
        email: user.email,
        displayName: profile?.data?.name || user.displayName,
        timezone: validTimezone(profile?.data?.timezone),
      }
    : null;

  return (
    <LanguageProvider>
      <Workspace
        account={account}
        initialMode={mode}
        initialView={view}
        initialConversationId={conversationId}
        initialNow={new Date().toISOString()}
      />
    </LanguageProvider>
  );
}
