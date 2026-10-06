import type { Metadata, Viewport } from "next";
import { QuipusExperience } from "@/components/experience/QuipusExperience";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Quipus",
  title: {
    default: "Quipus — Conversation intelligence",
    template: "%s · Quipus",
  },
  description:
    "Record meetings. Review the details. Follow up. Keep every conversation moving with Quipus.",
  category: "business",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#F5F3ED",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body><QuipusExperience>{children}</QuipusExperience></body>
    </html>
  );
}
