import type { Config } from 'tailwindcss';

export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      animation: {
        shine: "shine 1s forwards",
      },
      keyframes: {
        shine: {
          "100%": { left: "150%" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

