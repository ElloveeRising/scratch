import type { Metadata, Viewport } from "next";
import { Courier_Prime } from "next/font/google";
import "./globals.css";

const font = Courier_Prime({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scratch Pad",
  description: "A frictionless cross-device scratchpad.",
  applicationName: "Scratch Pad",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Scratch Pad",
    statusBarStyle: "black-translucent",
  },
  // Next emits the modern `mobile-web-app-capable`; add the legacy Apple tag too
  // so older iOS also launches standalone from the home screen.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6e4c2c",
  viewportFit: "cover",
  // When the on-screen keyboard opens, shrink the layout to the space above it
  // (instead of letting the keyboard overlay/hide the Save button on phones).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={font.variable}>
      <body className="font-mono antialiased bg-desk text-ink">
        {children}
      </body>
    </html>
  );
}
