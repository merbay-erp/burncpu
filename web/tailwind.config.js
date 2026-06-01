/** @type {import('tailwindcss').Config} */
// Mirrors stitch_burncpu/burncpu_aesthetic/DESIGN.md token system.
// 90/7/3 neutral / structural / amber discipline.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Material 3-style tonal layers — themeable via CSS vars (styles.css):
        // dark by default, `html.light` swaps the channels. `/ <alpha-value>`
        // keeps Tailwind opacity modifiers (e.g. bg-primary/15) working.
        background: 'rgb(var(--c-background) / <alpha-value>)',
        surface: 'rgb(var(--c-background) / <alpha-value>)',
        'surface-dim': '#131313',
        'surface-bright': '#393939',
        'surface-container-lowest': 'rgb(var(--c-surface-container-lowest) / <alpha-value>)',
        'surface-container-low': 'rgb(var(--c-surface-container-low) / <alpha-value>)',
        'surface-container': 'rgb(var(--c-surface-container) / <alpha-value>)',
        'surface-container-high': 'rgb(var(--c-surface-container-high) / <alpha-value>)',
        'surface-container-highest': 'rgb(var(--c-surface-container-highest) / <alpha-value>)',
        'on-background': 'rgb(var(--c-on-background) / <alpha-value>)',
        'on-surface': 'rgb(var(--c-on-surface) / <alpha-value>)',
        'on-surface-variant': 'rgb(var(--c-on-surface-variant) / <alpha-value>)',
        'inverse-surface': '#e5e2e1',
        'inverse-on-surface': '#303030',
        'outline': 'rgb(var(--c-outline) / <alpha-value>)',
        'outline-variant': 'rgb(var(--c-outline-variant) / <alpha-value>)',
        'surface-tint': '#9ce16d',         // turtle moss

        primary: 'rgb(var(--c-primary) / <alpha-value>)',
        'on-primary': 'rgb(var(--c-on-primary) / <alpha-value>)',
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
        'on-secondary-container': 'rgb(var(--c-on-secondary-container) / <alpha-value>)',
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

        error: 'rgb(var(--c-error) / <alpha-value>)',
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
