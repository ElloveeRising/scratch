import type { MetadataRoute } from "next";

// Web App Manifest — lets the site install to the home screen and run
// standalone (no browser chrome), like a native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scratch Pad",
    short_name: "Scratch",
    description: "A frictionless cross-device scratchpad.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#6e4c2c",
    theme_color: "#6e4c2c",
    icons: [
      { src: "/icon-png/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-png/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-png/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
