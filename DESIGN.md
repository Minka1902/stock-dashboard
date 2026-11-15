# Design

Visual system for the Stock Signal terminal. Dark-first, monospace-led, one committed accent. The metaphor is a pro trading desk: a strict ruled grid carries a maximal, vivid surface so intensity never reads as chaos.

## Theme

Dark, non-negotiable. Scene: a self-directed ADHD investor scanning market mood and their own positions on a large monitor in a dim home office before the open, wanting to feel in command. Light theme is a supported fallback but the design is tuned for dark.

## Color

Strategy: **Committed**. A warm amber phosphor accent carries brand, selection, focus, and "live" state across the surface. Data direction is a separate, fixed semantic pair (up = mint, down = crimson) so the accent never competes with price meaning. Amber is deliberately chosen to dodge the four reflexes: not SaaS purple, not corporate gold-on-navy, not crypto neon-green, not console cyan.

All values OKLCH. Neutrals are tinted a hair warm (hue ~80, chroma ≤ 0.011) so the whole surface reads as one family. Never `#000` / `#fff`.

Dark (primary):
- `--bg`: oklch(0.145 0.007 80)
- `--surface`: oklch(0.183 0.008 80)
- `--surface-2`: oklch(0.223 0.009 80)
- `--surface-3`: oklch(0.265 0.010 80)  (raised: menus, active row)
- `--grid`: oklch(1 0 0 / 0.055)  (hairline ruling, the terminal skeleton)
- `--border`: oklch(1 0 0 / 0.11)
- `--border-strong`: oklch(1 0 0 / 0.22)
- `--text`: oklch(0.945 0.006 80)
- `--text-muted`: oklch(0.72 0.010 80)
- `--text-faint`: oklch(0.56 0.012 80)
- `--accent`: oklch(0.82 0.145 75)   (amber phosphor)
- `--accent-strong`: oklch(0.76 0.16 68)
- `--accent-weak`: oklch(0.82 0.145 75 / 0.15)
- `--accent-glow`: oklch(0.82 0.145 75 / 0.35)  (used only for focus/live glow)
- `--positive`: oklch(0.84 0.17 158)  (mint, price up)
- `--positive-weak`: oklch(0.84 0.17 158 / 0.16)
- `--negative`: oklch(0.64 0.215 20)  (crimson, price down)
- `--negative-weak`: oklch(0.64 0.215 20 / 0.16)
- `--info`: oklch(0.74 0.11 232)  (cool, neutral/secondary series)

Light (fallback): same roles, lightness inverted, chroma trimmed ~15%, accent darkened to oklch(0.62 0.15 68) for AA on light.

Semantics: up/down is never color-only. Always pair with a glyph (▲ ▼), sign, or position so it survives color-blindness and the dyslexia mode.

## Typography

Monospace-led, the terminal signature.
- `--mono`: ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", "Roboto Mono", Consolas, monospace. Carries all numbers, tickers, labels, table data, most UI chrome. `font-variant-numeric: tabular-nums` everywhere numbers align.
- `--sans`: system-ui, "Segoe UI", Roboto, sans-serif. Prose only: news bodies, help text, longer copy. Capped 68ch.
- Labels are uppercase mono, letter-spacing `--caption-spacing` (0.09em; 0.06em on a phone), `--text-faint`, `--fs-caption`. This "terminal caption" is the primary hierarchy device.
- Every `font-size` is a token (`index.css`): one per size in use, named by its desktop px (`--fs-9` … `--fs-16`), plus roles `--fs-lead` 17, `--fs-h3` 18, `--fs-h2` 22, `--fs-h1` 30, `--fs-hero` 34, `--fs-display` 44, and `--fs-caption` / `--fs-small` / `--fs-body` = 11 / 12.5 / 14. Canvas text (charts) reads the same tokens. Big numbers (gauge score, position P/L) use the top of the scale in mono, weight 600. The phone remaps every token (see Phone).
- Hierarchy from weight + case + color, not many sizes.

## Layout

- App shell: slim fixed left rail (icon + mono label) with exactly the five modules, a market-lean status strip pinned top, a live ticker tape below it. Rail footer holds only a Settings gear (utility, not a module).
- Every view is a **ruled grid**: 1px `--grid` hairlines divide regions (no floating cards). Regions are labeled with the uppercase-mono caption in their top-left, like terminal panes.
- Density is a feature: tables run edge to edge, rows are compact (32-36px), zebra via `--surface`/`--surface-2` at very low delta.
- Avoid the SaaS card grid entirely. Use ruled panes, split columns, and full-bleed tables. No nested containers.
- Responsive is structural: rail collapses to icon-only, multi-column panes stack.
  Fixed breakpoints (custom properties can't be used inside `@media`):
  - 1000px: two-column panes stack.
  - 900px: the rail drops to icons.
  - 640px (phone): its own layout, below. Desktop layout is unaffected by it.
  - 560px: a small phone.

## Phone (≤640px)

The phone is a full surface, not a stacked desktop: every desktop task is possible, each view answers its question in the first screen, and the desktop (>640px) renders exactly as it did before. `npm run shots:mobile` (CLAUDE.md) gates all of it.

### Type scale

The phone block in `index.css` remaps every token, times `--type-scale`, the Settings **Text size** (`html[data-text-scale]`: compact 0.93, default 1, large 1.08). The root size is 13.5px (14.5 on a desktop).

| Token | Desktop | Phone |
|---|---|---|
| `--fs-9`, `--fs-9-5`, `--fs-10`, `--fs-10-5` | 9, 9.5, 10, 10.5 | unchanged |
| `--fs-11` (caption) | 11 | 10.5 |
| `--fs-11-5` | 11.5 | 11 |
| `--fs-12` | 12 | 11.5 |
| `--fs-12-5` (small, UI) | 12.5 | 12 |
| `--fs-13` | 13 | 12.5 |
| `--fs-13-5` | 13.5 | 13 |
| `--fs-14` (body) | 14 | 13 |
| `--fs-15` | 15 | 14 |
| `--fs-16` | 16 | 14.5 |
| `--fs-lead` | 17 | 15 |
| `--fs-h3` | 18 | 16 |
| `--fs-h2` | 22 | 18 |
| `--fs-h1` | 30 | 22 |
| `--fs-hero`, `--fs-display` | 34, 44 | `clamp(26px, 8vw, 34px)` |

Text fields are 16px on a phone whatever the scale (`!important`), so iOS never zooms on focus. `text-size-adjust: 100%` keeps the browser from inflating anything.

### Controls

One rule under `(pointer: coarse)` in `index.css`, zero specificity so a module's own size wins:
- Buttons, tabs and `summary` are `--control-h` (34px) tall, min 32px wide, and an invisible `::after` grows the hit area to `--tap` (40px) both ways.
- Fields (`input`, `select`, `textarea`), primary buttons (`data-variant="primary"`) and a form's submit are `--field-h` (44px).
- Checkboxes and radios are 20px.
- A glyph that must stay small sets `min-height`/`min-width: 0` and relies on the `::after`.

### Layout contract

The `index.css` phone block, one set of rules for every view:
- **One gutter.** A pane's content sits `--gutter` (12px) in from its edges; modules write pane padding as `var(--gutter, <desktop inset>)`, and `--gutter` exists only on a phone.
- **Header rule.** A section's header (its `<header>`, or a first-child `div` holding its heading or caption) is a title row, then everything else on the next row. `data-head="inline"` keeps short controls beside the title, wrapping only when they do not fit.
- **No sideways push.** Grid and flex children get `min-width: 0`, long words break, and grid tracks are `minmax(min(Npx, 100%), 1fr)`.
- **No nested containers.** A card inside a pane (`[data-card]`) loses its border, background, radius and side padding, so its content lands on the pane's gutter.
- Only `CorrelationHeatmap` (and rows of chips that say so) scrolls sideways.

### Tables

`DataTable` is the one table. With `layout="auto"` it is a table above 640px and a list of two-line cards (`DataCards` / `DataCard`) at or below. Each column says where it goes on a card (`phone`):

| Role | On the card |
|---|---|
| `title` | what the row is (left, first line) |
| `subtitle` | its second identifier (left, second line) |
| `value` | the number the view is about (right; `tone` adds ▲/▼ and colour) |
| `meta` (default) | a caption/value grid revealed by tapping the card |
| `hidden` | not shown; said elsewhere on the card |
| `actions` | the table's own actions column; the card uses `rowActions` (a "⋯" menu) |

Sorting moves to a sort picker above the list, beside any `toolbar` filters. `layout="cards"` forces cards, `"table"` a table, `"scroll"` a sideways-scrolling table (`CorrelationHeatmap`); `cardsBelow` switches to cards when the table's own container is that narrow.

### Sheets

- `Sheet`: the modal layer (scrim + raised panel). Centred on a desktop, a bottom sheet with a grabber on a phone. `Dialog` and every `Popover` use it, so every menu, picker, the account menu and the alerts list open as bottom sheets on a phone.
- `Dialog` with `form`: a form sheet. On a phone it takes the full height (`100dvh` less the top inset), rows marked `data-fields` stack one field per row, and the footer is pinned above the safe area with its buttons sharing the width.
- `FormSheet`: a form that sits in its page on a desktop and opens as a full-height form sheet on a phone.
- `SheetActions`: a form's buttons. In a form sheet they move to the pinned footer (a submit names its form with `form={id}`); elsewhere they render in place.

### Long pages

- `PanelInfo`: a panel title's info control. On a phone the panel's blurb is hidden and the "i" carries it, followed by the glossary definition.
- `ScrollRow`: controls that keep the parent's layout on a desktop and become one sideways-scrolling row (behind a `ScrollHint` fade) on a phone. `Segmented overflow="scroll"` does the same for a segmented strip, scrolling the active item into view.
- `ShowAll` + `usePhoneLimit`: a phone list cut to its first rows, then "Show all N …" / "Show fewer".
- `PhoneFold`: a section of a long page that is a `CollapsibleSection` on a phone (folded or open per `useCollapsedSections`) and the page's own section on a desktop.
- `SectionIndex`: a sticky, sideways-scrolling row of chips, one per section; a chip opens its section and scrolls to it, and the section at the top is marked current. Settings, Info, Server, the stock page and Overview use it.

### Shell

- **Ticker tape**: 36px row, symbol bold then price and change at the UI size, a fixed 28 px/s scroll; the US/TASE session stamps collapse to one button of dots (filled while trading, a ring when closed; tap for the text). Two whole quotes fit at 360px.
- **Top bar**: one row: title, status dot (the word stays for screen readers), `SourceHealth` compact (one pulsing glyph and the count; a tap opens a sheet listing each failing source and its error), search, alerts, account. Refresh, theme, dyslexia and tour live in the account menu.
- **Tab bar** (`MobileNav`): 2–5 pinned views plus More. Pins are the `phoneTabs` setting, default the five core views. The More sheet lists every view under Modules / Tools / App, each with a pin toggle and a reset.
- **Back to top** sits above the tab bar: `App.module.css` sets `--bottom-chrome` (tab bar + bottom inset on views, the inset alone on the stock page).
- **Stock page**: a sticky compact header (Back, ticker, price, change), Watch and Paper trade up front, the rest in "⋯"; the chart first at about half the screen, one toolbar row (scrolling timeframes + a Chart tools sheet), and only entry, stop, target and last-price axis labels unless LABELS is on.

### Touch

- **Explainers by tap.** Under `(hover: none)` a tooltip whose trigger is not a control (InfoTip, Term, status chips, a disabled button's reason) opens and closes on a tap; a tap elsewhere or Esc closes it; a scroll never opens or closes one (`lib/taps.js`: a press that lifts within 10px). Content over 180 characters opens as a sheet.
- **Long-press on controls.** A control's tooltip opens on a 500ms press, so its tap still acts. Nothing is hover-only: a hidden-on-hover action has a visible or row-menu alternative.
- **Chart gestures.** One finger pans time, two pinch-zoom it, a vertical swipe scrolls the page; a tap pins the crosshair and OHLC readout to a bar, a second tap clears it. Drawing tools work by tap.
- **Drag.** A watchlist row's drag handle starts a drag only after a 350ms hold (`touch-action: pan-y`), so a swipe from it scrolls; Move up/down stay in the row menu.
- **Keyboards.** Number fields set `inputmode` (decimal for prices, shares and amounts) and free fields `enterkeyhint`; the TOTP field is `inputmode="numeric"` with `autocomplete="one-time-code"`.

### Viewport

Heights that a mobile URL bar changes use `dvh` (shell, rail, sheets, menus, the alerts list). `viewport-fit=cover` turns on `env(safe-area-inset-*)`: the main column pads the top inset, the app the side insets (landscape), and the tab bar, sheets and form-sheet footers the bottom one.

## Elevation

Mostly flat. Depth via hairline borders and a faint 1px top highlight, not drop shadows. Raised surfaces (command palette, menus) get `--surface-3` + a single soft shadow. No glassmorphism. The only glow in the system is the amber focus/live glow, used sparingly.

## Components

Consistent vocabulary, every state (default / hover / focus / active / disabled / loading / error):
- **Stat cell**: mono label (caption) + big tabular number + signed delta with ▲/▼ in positive/negative. The atomic unit; never a gradient hero tile.
- **Meter bar**: inline block-bar (`████░░░░`) or thin track, used for conviction, gauges, allocation. Amber or semantic fill.
- **Fear→Greed gauge**: the hero of Market Sentiment. A wide horizontal spectrum with an animated amber needle and a big mono score.
- **Ticker tape**: horizontally scrolling live quotes, mono, colored deltas, pausable, respects reduce-motion.
- **Data table**: sticky mono header (uppercase caption), tabular-nums, row hover = `--surface-3`, right-aligned numerics, inline sparklines.
- **Source badge**: every data region shows a live/stale/error dot + "updated Ns ago" (honest state, never hidden). Sources that are failing right now sit in the top bar (`SourceHealth`): a "Not responding" caption and one pulsing glyph per source (its icon from `lib/sources.js`), a tooltip with the recorded error, overflow as "+N"; under reduced motion the glyph is solid red with ▲. Nothing renders while every source is healthy.
- **Command palette (⌘K)**: keyboard jump to any of the five views and quick actions. Terminal-native, ADHD quick-nav.
- Loading = skeleton rows/shimmer, never center spinners. Empty states teach ("add holdings to see P/L"), never blank.

## Motion

Maximal but meaningful, and fully collapsible under `prefers-reduced-motion` / the reduce-motion setting.
- Timing 120-220ms, ease-out-expo / quart. No bounce.
- Numbers count-up / roll on change; fresh data shimmers once; the gauge needle eases to position; "live" dots pulse; the ticker tape scrolls.
- Never animate layout properties; transform/opacity only.
- Reduce-motion collapses all of the above to instant state changes; nothing essential is motion-only.

## Signature

If you removed the amber and the monospace ruling, it should stop looking like this product. The tell: ruled terminal panes with uppercase-mono captions, tabular numbers with ▲/▼ deltas, an amber live-glow, and a hero Fear→Greed gauge.
