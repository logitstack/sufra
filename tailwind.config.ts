import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        maroon: {
          50:  '#FBF1F1',
          100: '#F4E5E5',
          300: '#D89697',
          500: '#9C3537',
          700: '#7A2426',
          900: '#5C1A1B',
          950: '#3A0F10'
        },
        beige: {
          50:  '#FAF6F0',
          100: '#F0E8DA',
          200: '#E3D5BD',
          300: '#D1BC97',
          700: '#8B7355',
          900: '#5C4A33'
        },
        ink: '#2A1F1A'
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        body:    ['var(--font-inter)', 'system-ui', 'sans-serif']
      },
      letterSpacing: {
        'wordmark': '0.02em',
        'eyebrow':  '0.18em'
      },
      boxShadow: {
        'card':       '0 1px 2px rgba(58, 15, 16, 0.04), 0 8px 24px -8px rgba(58, 15, 16, 0.08)',
        'card-hover': '0 2px 4px rgba(58, 15, 16, 0.06), 0 16px 40px -12px rgba(58, 15, 16, 0.18)'
      }
    }
  },
  plugins: []
};

export default config;
