import type { Metadata } from "next";
import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Explore the demo | Quipus",
  description: "Try sample conversations, meeting reports, and follow-up approvals before signing in.",
  robots: { index: false, follow: true },
};

export default function DemoPage() {
  return <WorkspaceRoute mode="sample" view="overview" />;
}
