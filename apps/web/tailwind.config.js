/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6f8', 100: '#d5e9ef', 200: '#abd2de', 300: '#78b4c6', 400: '#4b93aa',
          500: '#2f7790', 600: '#235f75', 700: '#1e4d60', 800: '#1c4150', 900: '#1a3744', 950: '#0f222b',
        },
        gold: { 400: '#f2c14e', 500: '#e0a82e', 600: '#c28a1c' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
