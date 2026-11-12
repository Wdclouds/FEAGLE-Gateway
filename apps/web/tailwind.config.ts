import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        theme: {
          root: 'var(--bg-root)',
          header: 'var(--bg-header)',
          card: 'var(--bg-card)',
          'card-subtle': 'var(--bg-card-subtle)',
          border: 'var(--border-main)',
          'border-subtle': 'var(--border-subtle)',
          text: 'var(--text-main)',
          'text-muted': 'var(--text-muted)',
          accent: 'var(--color-accent)',
          'accent-hover': 'var(--color-accent-hover)',
          'accent-subtle': 'var(--color-accent-subtle)',
        },
        cyber: {
          bg: '#070a13',
          panel: 'rgba(15, 23, 42, 0.75)',
          border: 'rgba(56, 189, 248, 0.15)',
          cyan: '#00f0ff',
          neonGreen: '#10b981',
          neonAmber: '#f59e0b',
          neonRed: '#ef4444',
          neonPurple: '#a855f7',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        dseg: ['DSEG7', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
} satisfies Config;
