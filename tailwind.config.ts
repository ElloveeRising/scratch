import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#f4f1ea",
        desk: "#6e4c2c",
        manila: "#ecdca6",
        stamp: "#a8442e",
        ink: "#1c1b1a",
        status: {
          offline: "#d4760f",
          syncing: "#2563eb",
          synced:  "#4a7c59",
        },
      },
      fontFamily: {
        // Overrides Tailwind's default font-mono with Courier Prime (injected via CSS var)
        mono: ["var(--font-mono)", "Courier New", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
