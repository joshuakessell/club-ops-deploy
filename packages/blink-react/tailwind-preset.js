import forms from '@tailwindcss/forms';
import daisyui from 'daisyui';

/**
 * blink-react Tailwind preset (Tailwind v4 compatible).
 *
 * Notes:
 * - DaisyUI is enabled here (internal implementation detail of blink-react).
 * - Apps should NOT reference DaisyUI classes directly; use blink-react components.
 */
export default {
  darkMode: 'class',
  theme: {
    extend: {
      borderRadius: {
        blink: '0.875rem',
      },
      boxShadow: {
        blinkPanel: '0 1px 2px 0 rgb(0 0 0 / 0.06)',
        blinkCard: '0 1px 3px 0 rgb(0 0 0 / 0.12), 0 1px 2px -1px rgb(0 0 0 / 0.12)',
      },
    },
  },
  plugins: [forms({ strategy: 'class' }), daisyui],
  daisyui: {
    themes: ['light', 'dark'],
    darkTheme: 'dark',
  },
};

