/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          from: { boxShadow: '0 0 4px rgba(251, 146, 60, 0.4)' },
          to: { boxShadow: '0 0 16px rgba(251, 146, 60, 0.9)' },
        },
      },
    },
  },
  plugins: [],
}
