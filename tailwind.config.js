/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens resolve to CSS variables (space-separated RGB channels)
        // so a theme is a swap of --ide-* values, not a rebuild. The dark values
        // live in styles/index.css :root; the Cortex Light values under
        // :root[data-theme='light']. The <alpha-value> shim keeps opacity
        // utilities (bg-ide-red/15, ring-ide-accent) working. See docs/THEME.md.
        ide: {
          bg: 'rgb(var(--ide-bg) / <alpha-value>)', // editor background
          panel: 'rgb(var(--ide-panel) / <alpha-value>)', // side panels, tab bar (elevation 1)
          bar: 'rgb(var(--ide-bar) / <alpha-value>)', // toolbars, activity bar, popovers (elevation 2)
          border: 'rgb(var(--ide-border) / <alpha-value>)',
          hover: 'rgb(var(--ide-hover) / <alpha-value>)',
          active: 'rgb(var(--ide-active) / <alpha-value>)', // selection
          accent: 'rgb(var(--ide-accent) / <alpha-value>)',
          text: 'rgb(var(--ide-text) / <alpha-value>)',
          muted: 'rgb(var(--ide-muted) / <alpha-value>)',
          faint: 'rgb(var(--ide-faint) / <alpha-value>)',
          // identity hues
          navy: 'rgb(var(--ide-navy) / <alpha-value>)',
          amber: 'rgb(var(--ide-amber) / <alpha-value>)',
          moss: 'rgb(var(--ide-moss) / <alpha-value>)',
          // semantic
          green: 'rgb(var(--ide-green) / <alpha-value>)',
          yellow: 'rgb(var(--ide-yellow) / <alpha-value>)',
          red: 'rgb(var(--ide-red) / <alpha-value>)',
          purple: 'rgb(var(--ide-purple) / <alpha-value>)',
          cyan: 'rgb(var(--ide-cyan) / <alpha-value>)',
          // AA-safe badge labels (text on a bg-ide-HUE/15 tint) and a solid
          // danger surface for white button text. See contrast.test.ts.
          'on-red': 'rgb(var(--ide-on-red) / <alpha-value>)',
          'on-amber': 'rgb(var(--ide-on-amber) / <alpha-value>)',
          'on-moss': 'rgb(var(--ide-on-moss) / <alpha-value>)',
          danger: 'rgb(var(--ide-danger) / <alpha-value>)'
        }
      },
      backgroundImage: {
        // The one expressive moment. Reserve for splash, logo, active-toolbar
        // underline, build/flash progress, and focus glow.
        'cortex-gradient': 'linear-gradient(115deg, #2E6FE0 0%, #E8952B 55%, #6FB65A 100%)',
        'cortex-gradient-v': 'linear-gradient(180deg, #2E6FE0 0%, #E8952B 55%, #6FB65A 100%)'
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'Consolas', 'monospace'],
        sans: ['"Inter"', '"Segoe UI"', 'system-ui', 'sans-serif']
      },
      keyframes: {
        'gradient-slide': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' }
        }
      },
      animation: {
        'gradient-slide': 'gradient-slide 2.2s ease infinite'
      }
    }
  },
  plugins: []
}
