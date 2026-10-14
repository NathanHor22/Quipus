import type { Metadata } from "next";
import QuipusLanding from "@/components/landing/QuipusLanding";

const publicOrigin = process.env.NEXT_PUBLIC_APP_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "https://roxanne-two.vercel.app");

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin),
  title: { absolute: "Quipus | Be present. Know what matters." },
  description: "Good follow-ups start with understanding the person. Quipus helps you stay present, remember what matters to your clients, and leave every meeting with a clear next step.",
  openGraph: {
    title: "Quipus | Be present. Know what matters.",
    description: "Be present with your clients. Remember their priorities, revisit the conversation, and keep the next step moving with Quipus.",
    type: "website",
    images: [{ url: "/landing/quipus-prototype.webp", width: 1400, height: 1000, alt: "Quipus prototype case" }],
  },
};

export default function HomePage() {
  return <QuipusLanding />;
}
