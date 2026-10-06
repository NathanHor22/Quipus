import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quipus — Conversation intelligence",
    short_name: "Quipus",
    description:
      "Record meetings. Review the details. Follow up.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F5F3ED",
    theme_color: "#F5F3ED",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/quipus-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/quipus-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
