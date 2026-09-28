/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      keyframes: {
        buzz: {
          '0%, 100%': { transform: 'translateX(0) rotate(0deg)' },
          '10%': { transform: 'translateX(-2px) rotate(-1deg)' },
          '30%': { transform: 'translateX(3px) rotate(1deg)' },
          '50%': { transform: 'translateX(-3px) rotate(-1deg)' },
          '70%': { transform: 'translateX(2px) rotate(1deg)' },
          '90%': { transform: 'translateX(-1px) rotate(0deg)' },
        },
        flip: {
          '0%': { transform: 'rotateX(90deg)', opacity: '0.2' },
          '100%': { transform: 'rotateX(0deg)', opacity: '1' },
        },
        'slide-in': {
          '0%': { transform: 'translateY(-12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        buzz: 'buzz 0.6s ease-in-out',
        flip: 'flip 0.5s ease-out',
        'slide-in': 'slide-in 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
