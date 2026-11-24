/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // School colours: navy #1E1D37 (brand-900), red #CA0C1E (accent-600), cream #F4F1EB (cream-100).
        brand: {
          50: '#f0f0f6', 100: '#dcdcea', 200: '#b9b8d3', 300: '#8f8db4', 400: '#67658f',
          500: '#4a4870', 600: '#3a3859', 700: '#2e2d4a', 800: '#26253f', 900: '#1e1d37', 950: '#13122a',
        },
        accent: {
          50: '#fdecee', 100: '#fbd0d4', 200: '#f5a3ab', 300: '#ec6b78', 400: '#e03a4b',
          500: '#d61f31', 600: '#ca0c1e', 700: '#a90a19', 800: '#8a0915', 900: '#6e0811',
        },
        cream: { 50: '#faf8f4', 100: '#f4f1eb', 200: '#e8e2d6', 300: '#d9d0bf' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
