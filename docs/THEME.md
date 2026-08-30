# Theme (Cortex Dark)

Cortex uses one cohesive dark theme with a signature multi-gradient accent, in the spirit of the
JetBrains product themes. Deep navy base (not pure black), a single restrained navy accent in idle
chrome, and a tri-hue identity (navy, amber, moss) that appears **only** in the signature gradient
and the syntax tokens. This keeps the low-level embedded feel without visual noise.

The palette lives in `tailwind.config.js` under `theme.extend.colors.ide` and the Monaco editor
theme in `src/renderer/src/components/CodeEditor.tsx` (`cortex-dark`). Keep the two in sync.

## Base tokens

| Token | Hex | Use |
|---|---|---|
| `ide.bg` | `#0C1017` | editor background (elevation 0) |
| `ide.panel` | `#11161F` | side panels, tab bar (elevation 1) |
| `ide.bar` | `#171D28` | toolbars, activity bar, popovers (elevation 2) |
| `ide.border` | `#232B38` | borders, dividers |
| `ide.hover` | `#1B2230` | hover states |
| `ide.active` | `#1E3A5F` | selection (navy) |
| `ide.accent` | `#3B82F6` | dominant chrome accent (buttons, focus) |
| `ide.text` | `#E6EBF4` | primary text |
| `ide.muted` | `#98A3B6` | secondary text |
| `ide.faint` | `#5B6675` | tertiary / placeholder text |

## Identity hues and gradient

| Token | Hex |
|---|---|
| `ide.navy` | `#2E6FE0` |
| `ide.amber` | `#E8952B` |
| `ide.moss` | `#6FB65A` |

Signature gradient: `linear-gradient(115deg, #2E6FE0 0%, #E8952B 55%, #6FB65A 100%)`
(Tailwind: `bg-cortex-gradient`, vertical variant `bg-cortex-gradient-v`).

Reserve the gradient for one expressive moment per surface: the logo mark, the activity-bar active
rail, the status-bar build/flash progress line, and focus glow. Never loop it in the idle work area.
Respect `prefers-reduced-motion`.

## Syntax tokens (Monaco cortex-dark)

| Token | Hex | Note |
|---|---|---|
| keyword | `#E8952B` | amber, Arduino warmth / register feel |
| number | `#E8B44A` | amber-gold |
| string | `#8FBF6B` | moss |
| type | `#4FB8A8` | teal-moss |
| function | `#5B9DF0` | navy, a shade lighter than chrome accent |
| comment | `#5B6675` | faint, italic |
| macro / `#define` / register | `#C58BE6` | violet |

All identifier/keyword tokens are contrast-checked at >= 4.5:1 on `#0C1017`; comments >= 3:1 by
intent.

See [`STYLE.md`](STYLE.md) for the copy and visual-language rules (including: no em dashes).
