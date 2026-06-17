import type { Metadata } from "next";
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
  description: "A frictionless scratchpad",
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
