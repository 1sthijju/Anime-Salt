/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#08080f',
        surface: '#0e0e1a',
        card: '#151527',
        line: '#23233a',
        muted: '#8a8aa3',
        accent: { DEFAULT: '#8b5cf6', soft: '#a78bfa' },
        pink: '#ec4899',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 40px rgba(139, 92, 246, 0.25)',
        'glow-lg': '0 0 80px rgba(139, 92, 246, 0.35)',
      },
    },
  },
  plugins: [],
};