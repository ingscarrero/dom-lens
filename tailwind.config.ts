import type { Config } from 'tailwindcss';

export default {
  content: ['./entrypoints/**/*.{html,ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          bg: '#1e1e1e',
          surface: '#252526',
          border: '#3c3c3c',
          text: '#cccccc',
          muted: '#858585',
          accent: '#0ea5e9',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
