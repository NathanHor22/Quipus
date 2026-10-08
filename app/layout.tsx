import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { QuipusExperience } from "@/components/experience/QuipusExperience";
import "./globals.css";

const geist = localFont({
  src: "./fonts/Geist.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

const michroma = localFont({
  src: "./fonts/Michroma-Regular.ttf",
  variable: "--font-michroma",
  weight: "400",
  display: "swap",
  preload: false,
});

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
  colorScheme: "light",
  themeColor: "#F5F6F8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={[geist.variable, michroma.variable].join(" ")}>
      <body><QuipusExperience>{children}</QuipusExperience></body>
    </html>
  );
}
