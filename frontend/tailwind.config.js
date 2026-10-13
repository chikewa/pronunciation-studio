/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f4f6f8',
          100: '#e8edf1',
          200: '#cfd9e0',
          300: '#a7bac8',
          400: '#7792a6',
          500: '#55748c',
          600: '#435d74',
          700: '#384c5e',
          800: '#314150',
          900: '#2b3844',
          950: '#1b2530',
        },
        accent: {
          50: '#eef7ff',
          100: '#d9edff',
          200: '#bce0ff',
          300: '#8ecdff',
          400: '#59b0ff',
          500: '#338fff',
          600: '#1b6ef5',
          700: '#1457d1',
          800: '#1748a9',
          900: '#193f85',
          950: '#14284f',
        },
        good: { 500: '#22a06b', 100: '#d9f2e6', 700: '#157347' },
        warn: { 500: '#d97706', 100: '#fdeccc', 700: '#92500a' },
        bad: { 500: '#d64545', 100: '#fbe3e3', 700: '#9c2b2b' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
