// ICT Distribution Africa Tailwind preset. Usage in tailwind.config: presets: [require('./brand/tokens/tailwind.preset.js')]
// Colours point at the CSS variables in tokens.css, so light and dark switch automatically.
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        'bg': 'var(--bg)',
        'surface': 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        'border': 'var(--border)',
        'text': 'var(--text)',
        'text-muted': 'var(--text-muted)',
        'brand': 'var(--brand)',
        'brand-hover': 'var(--brand-hover)',
        'on-brand': 'var(--on-brand)',
        'brand-text': 'var(--brand-text)',
        'accent': 'var(--accent)',
        'on-accent': 'var(--on-accent)',
        'accent-text': 'var(--accent-text)',
        'focus': 'var(--focus)',
        'success': 'var(--success)',
        'warning': 'var(--warning)',
        'danger': 'var(--danger)',
        'info': 'var(--info)'
      },
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-text)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' },
      boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)' },
      letterSpacing: { display: '-0.02em' },
    },
  },
};
