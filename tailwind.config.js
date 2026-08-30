/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cortex Dark: deep navy base, single restrained navy accent in chrome.
        // The tri-hue identity (navy / amber / moss) lives in the signature
        // gradient and the syntax tokens only. See docs/THEME.md.
        ide: {
          bg: '#0C1017', // editor background (Night Owl-depth navy)
          panel: '#11161F', // side panels, tab bar (elevation 1)
          bar: '#171D28', // toolbars, activity bar, popovers (elevation 2)
          border: '#232B38',
          hover: '#1B2230',
          active: '#1E3A5F', // selection (navy)
          // The chrome accent IS the identity navy. It was stock Tailwind
          // blue-500 (#3B82F6), which shipped two blues ~10 degrees apart.
          // GRAPHICS ONLY: 4.05:1 on bg clears the 3:1 bar for icons and
          // borders but not the 4.5:1 bar for text, on any surface.
          accent: '#2E6FE0',
          text: '#E6EBF4',
          // AA for text on bg/panel/bar/hover AND on active (4.52:1), which is
          // why selected rows switch their tertiary text to muted.
          muted: '#98A3B6',
          // Raised from #5B6675, which measured 3.27:1 on bg and failed WCAG AA
          // for the placeholder/tertiary text it is used for. AA on
          // bg/panel/bar only: on active it is 3.21:1, so do not use it there.
          faint: '#7D8899',
          // identity hues
          navy: '#2E6FE0',
          amber: '#E8952B',
          moss: '#6FB65A',
          // semantic
          green: '#6FB65A',
          yellow: '#E8B44A',
          red: '#E05561',
          purple: '#C58BE6',
          cyan: '#4FB8A8'
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
