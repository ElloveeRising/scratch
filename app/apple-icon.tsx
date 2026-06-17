import { ImageResponse } from "next/og";
import { iconArt } from "./lib/iconArt";

// iOS home-screen icon (Safari "Add to Home Screen" uses this, not the manifest).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(iconArt(180), { ...size });
}
