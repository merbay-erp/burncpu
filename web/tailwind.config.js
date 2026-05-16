/** @type {import('tailwindcss').Config} */
// Mirrors stitch_burncpu/burncpu_aesthetic/DESIGN.md token system.
// 90/7/3 neutral / structural / amber discipline.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Material 3-style tonal layers (dark)
        background: '#131313',
        surface: '#131313',
        'surface-dim': '#131313',
        'surface-bright': '#393939',
        'surface-container-lowest': '#0e0e0e',
        'surface-container-low': '#1b1b1c',
        'surface-container': '#202020',
        'surface-container-high': '#2a2a2a',
        'surface-container-highest': '#353535',
        'on-background': '#e5e2e1',
        'on-surface': '#e5e2e1',
        'on-surface-variant': '#c5d4b3',   // greenish-grey (was warm peach)
        'inverse-surface': '#e5e2e1',
        'inverse-on-surface': '#303030',
        'outline': '#7a8b6b',              // greenish-grey
        'outline-variant': '#3a4e2e',      // dark forest
        'surface-tint': '#9ce16d',         // turtle moss

        primary: '#9ce16d',                // turtle moss — slow + alive
        'on-primary': '#0f1f08',
        'primary-container': '#76c14c',
        'on-primary-container': '#0a1804',
        'inverse-primary': '#5a8a3a',
        'primary-fixed': '#c5f09a',
        'primary-fixed-dim': '#9ce16d',
        'on-primary-fixed': '#0a1804',
        'on-primary-fixed-variant': '#2d5018',

        secondary: '#c9c6c5',
        'on-secondary': '#313030',
        'secondary-container': '#4a4949',
        'on-secondary-container': '#bab8b7',
        'secondary-fixed': '#e5e2e1',
        'secondary-fixed-dim': '#c9c6c5',
        'on-secondary-fixed': '#1c1b1b',
        'on-secondary-fixed-variant': '#474646',

        tertiary: '#c6c6c7',
        'on-tertiary': '#2f3131',
        'tertiary-container': '#9fa0a0',
        'on-tertiary-container': '#353737',
        'tertiary-fixed': '#e2e2e2',
        'tertiary-fixed-dim': '#c6c6c7',
        'on-tertiary-fixed': '#1a1c1c',
        'on-tertiary-fixed-variant': '#454747',

        error: '#ffb4ab',
        'on-error': '#690005',
        'error-container': '#93000a',
        'on-error-container': '#ffdad6',

        'surface-variant': '#353535',
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.25rem',
        xl: '0.5rem',
        full: '9999px',
      },
      spacing: {
        'container-max': '1200px',
        'content-width': '680px',
        gutter: '24px',
        'margin-mobile': '16px',
        base: '8px',
      },
      maxWidth: {
        'content-width': '680px',
        'container-max': '1200px',
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        'body-md': ['Geist'],
        'body-lg': ['Geist'],
        'headline-lg': ['Geist'],
        'headline-xl': ['Geist'],
        'headline-lg-mobile': ['Geist'],
        'label-md': ['"JetBrains Mono"'],
        'label-sm': ['"JetBrains Mono"'],
      },
      fontSize: {
        'label-sm': ['12px', { lineHeight: '1.2', fontWeight: '400' }],
        'label-md': ['14px', { lineHeight: '1.4', letterSpacing: '0.02em', fontWeight: '500' }],
        'body-md': ['16px', { lineHeight: '1.5', fontWeight: '400' }],
        'body-lg': ['18px', { lineHeight: '1.6', fontWeight: '400' }],
        'headline-lg-mobile': ['24px', { lineHeight: '1.2', fontWeight: '600' }],
        'headline-lg': ['32px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        'headline-xl': ['40px', { lineHeight: '1.1', letterSpacing: '-0.04em', fontWeight: '700' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
