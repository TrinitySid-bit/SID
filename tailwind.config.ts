import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./pages/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bitcoin: "#F7931A",           // Primary accent
        bg: { DEFAULT: "#0B0F14" },    // Page background
        panel: "#11161C",              // Section background
        card: "#0F141A",               // Card background
        border: "#1F2937",             // Borders
        fg: {
          DEFAULT: "#E6EDF3",          // Main text
          muted: "#A9B6C2",            // Secondary
          subtle: "#8593A0",           // Tertiary
        },
      },
      boxShadow: {
        card: "0 6px 20px rgba(0,0,0,0.25)",
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};

export default config;
