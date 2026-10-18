# Control Room design system

The Control Room (`src/renderer/components/admin/AdminScreen.tsx` and every page
it renders) is a quiet operator console for a gaming café: dense and
typographic, in a dark or a light theme. Hierarchy comes from type, alignment
and tone, not from boxes or outlines. One brand accent, NXGS magenta, marks
what is chosen or actionable; other colour only carries meaning (status,
verified money, errors). Text is set at the size staff knew from 0.26.0 (see
Rules: type), with generous controls around it: inputs and buttons are 48px
high (only the compact controls the kit defines, small buttons, segments,
toggle chips, filter buttons and the inline switch, are 40px), and focus is
always a visible accent outline, because staff may drive it with a controller.

Customer surfaces (Home, Settings, the quick menu, PinDialog,
AdminOptionsDialog...) are out of scope: they keep Inter and the console look.
Nothing here touches `:root` tokens.

## Identity

What makes it NXGS rather than a default component theme:

- **One accent, NXGS magenta** (from the logo's neon; the logo runs cyan to
  magenta, but the Control Room uses magenta only, never both and never a
  gradient). It is used sparingly and only for: the primary button fill, the
  active nav marker, the focus outline, selected segments and chips (tint +
  accent text), checked boxes and radios, links, the switch "on" track, the
  selected-row bar, and the hero figure's small marker in Accounts. Text on an
  accent tint uses `--a-accent-strong`; text on the accent fill uses
  `--a-on-accent` (never white in the dark theme, never black in the light one).
- **Neutrals lean faintly violet** (hue about 300, very low chroma) toward the
  accent. Not zinc, not blue.
- **Type: the Red Hat family**, whose geometric shapes echo the NXGS wordmark,
  bundled offline from Fontsource and imported only by `admin/tokens.css`:
  - Red Hat Display (`--a-font-display`): the page title, section headings,
    modal titles, the sidebar "Control Room" and big figures (`Stat` values,
    with proportional figures).
  - Red Hat Text (`--a-font`): all other UI text. Tabular figures stay on for
    columns (set on `.admin-screen`).
  - Red Hat Mono (`--a-font-mono`): IDs, payment IDs, paths and key names.
- **Shape and lines: fewer outlines, crisper corners.** Radius 4px for panels,
  controls, badges, popovers and modals (segments inside a track 2px); the
  switch track is the only rounded-full element. Separate by tone before
  lines: tables, stat rows and grouped forms sit on `--a-panel` with no outer
  border, hairlines only between rows. Inputs are filled with a subtle border
  that is heavier at the bottom and turns accent on focus. Secondary buttons,
  chips, badges and filter buttons are tonal fills; ghost buttons are text.
  Outlines remain only where they mean something: the danger zone's red
  hairline, the selected chip's accent edge, floating surfaces (popover,
  modal) and the focus outline.
- **Icons only where they carry meaning.** No icons in the sidebar nav, in
  text buttons ("Refresh", "Export CSV", "Save device", "New game", "Whole
  store"), in segments, in header actions, in field labels or in headings.
  What stays, each because it is the only carrier of its meaning:
  icon-only buttons for row actions (delete, copy, reorder, close, clear
  search) with an `aria-label` (and a `title` where the action is not
  obvious); the leading magnifier of a search field; the dropdown chevron of
  a filter button; the row-expand chevron (Accounts) and row-open chevron
  (All devices); the external-link arrow after "View GitHub release"; the x
  of a removable filter chip; Notice icons; status dots and the verified
  check. Units in a field are words ("min", "sec", "₹"), not icons.
- **One signature element (the only bold move): the session timeline strip in
  Accounts.** A thin strip whose full width is the session's paid time,
  showing how it was used: one segment per game played (start/end relative to
  the session start, capped like the minutes), paid time without a game as
  empty `--a-line` track, and a 2px gap at every boundary between pieces (the
  strip's own ends stay square). Game segments alternate two neutral tones,
  `--a-text-2` and `--a-text-2` mixed 40% toward `--a-line` (`--a-text-3` sits
  too close to `--a-text-2` in the light theme to tell apart); never the
  accent and never a hue per game. Hover (and keyboard focus in the expanded
  row) turns a segment `--a-text` and shows the readout (`.accounts-tip`: a
  fixed popover with the game, its clock range and its minutes in bold; empty
  track reads "No game", a live session's remainder "Time left"). In the
  "Games played" cell it is 8px tall above the comma list and is one image
  with a spoken summary; in the expanded row it is 14px, its segments are
  focusable, and a clock scale sits under it (start and end of the paid time,
  quarter/half/hour ticks, hour labels where they fit; a live session adds a
  2px `--a-text` now mark and "Now"). It belongs to Accounts' own CSS; nothing
  else in the Control Room should compete with it.
- **Accounts' hero figure and share bars.** Accounts has exactly one hero
  figure, Total earned: `--a-size-hero` (Red Hat Display, about 62px at
  1920 and 48px at 1366) with proportional lining figures and a 2px accent bar
  before its label, the largest number in the Control Room. The three figures
  beside it (Paid sessions, Paid time, Most played game) are quieter:
  `--a-size-figure-text` Red Hat Text at the medium weight (36px / 28px), and
  the game name a step smaller (`--a-size-figure-name`, as the 0.26.0 tile
  had it). The By device and Top games share bars are single hue:
  an 8px `--a-text-3` fill on an `--a-line` track, square at the start and 2px
  rounded at the end, the value in its own right-aligned tabular column so
  every bar starts and ends on the same lines; hover or focus turns the fill
  `--a-text-2` and shows the exact value in the same readout.

## Themes

- **Choice:** *Dark · Light · System*, a three-way radio group (a compact
  segmented track, three equal segments) at the top of the sidebar footer,
  above "Back to Home" and the controller hints (`AdminThemeSwitch` in
  `AdminScreen.tsx`). Default Dark. System follows `prefers-color-scheme`
  live, which Electron takes from the Windows app theme. Tab reaches the
  chosen option; left/right (keys or the D-pad while it has focus) move and
  pick; Enter/Space/A pick. The group carries `data-admin-local-keys`, so
  arrows inside it never switch sections.
- **Controller limitation:** in the Control Room the D-pad moves between
  sections and nothing else, so a controller alone cannot move focus into the
  sidebar footer. The theme is chosen with the pointer or the keyboard (Tab);
  once an option has focus, D-pad left/right move and pick and A picks. This
  is deliberate (staff set the theme once per device); do not add a D-pad
  path into the footer that would compete with section switching.
- **Storage:** per station, in the renderer UI preferences
  (`src/renderer/ui/preferences.ts`): `localStorage['nxgs.ui.adminTheme']` =
  `dark | light | system`, read with `useAdminThemePreference()` and resolved
  with `useResolvedAdminTheme(preference)`.
- **Mechanism:** `AdminScreen` sets `data-admin-theme="dark|light"` (the
  resolved theme) on `.admin-screen`. `tokens.css` defines every colour token
  twice, under `.admin-screen[data-admin-theme='dark']` (also the default for a
  bare `.admin-screen`) and `.admin-screen[data-admin-theme='light']`, each with
  `color-scheme` so native selects, date pickers and scrollbars follow.
- **No literal colours.** No component or page rule may use a hex, `rgb()` or
  named colour; every colour comes from a `--a-*` token that both themes
  define (`transparent` and `currentColor` are fine). A new colour means a new
  token in both theme blocks, checked for contrast in both. The console
  tokens the shared pieces use (`--ps-*`, `--panel-*`, `--focus-*`, ...) are
  re-pointed to theme tokens in the bridge block, so they follow the theme too.
- **Overlays:** everything the Control Room renders lives inside
  `.admin-screen` and inherits the theme: the filter popovers, the installed
  game picker and the update restart dialog (`.modal-backdrop > .modal`), and
  page header actions (`PageActions` portals into the header). The one
  exception is the main admin `PinDialog`: `useOwnerSession` portals it to
  `.app-shell` and it keeps the shared console look (dark) in both themes,
  over its own blurred scrim. Do not portal admin UI out of `.admin-screen`;
  if something must be, give its root `data-admin-theme` and the
  `admin-screen` token scope or keep it console-styled like the PIN dialog.
- **Contrast:** body, secondary and tertiary text, accent text and every
  status colour reach 4.5:1 on the surfaces they sit on in both themes (bg,
  sidebar, panel, panel-2, inset, and their tints); the focus outline, the
  switch "on" track, checkbox borders and the field bottom line reach 3:1.
  Re-check with a contrast script when a token changes.

## Files

| File | Owns |
| --- | --- |
| `src/renderer/styles/admin/tokens.css` | The Red Hat font imports; the `--a-*` colour and weight tokens for the dark and light themes (with `color-scheme`); the theme-independent tokens (shape, type, sizes, layout, motion); and the bridge that re-points the global console tokens inside the Control Room (below) |
| `src/renderer/styles/admin/shell.css` | Screen grid, sidebar (brand tile, text nav, theme switch, footer), page container (1240 / 1760px), page header, scope note, header actions and the main admin chip |
| `src/renderer/styles/admin/kit.css` | Base elements inside `.admin-screen` and every shared primitive: panels and footers, buttons, fields, switch rows, inline switches, danger zone, segmented, toggle chips, badges, status text, stat row, tables (clickable and selected rows), notices, empty and loading, facts lists, list rows, FilterPopover with its pickers and active-filter chips, modals |
| `src/renderer/styles/admin/library.css` | Games (library list, editor groups, artwork, sticky save bar), the installed game picker modal (edge-to-edge list), Scan (results table, confidence bars) |
| `src/renderer/styles/admin/settings.css` | Sessions (play access choices, page save bar), Branding, Kiosk (diagnostics columns, exit PIN width), Updates (summary, progress, restart modal) |
| `src/renderer/styles/admin/plans.css` | Plans: table column widths and the editor's customer preview |
| `src/renderer/styles/admin/device.css` | Device: the device ID cell with its copy button |
| `src/renderer/styles/admin/accounts.css` | Accounts: filter bar layout, result line, sessions table columns and expanded row, the session timeline strip, By device / Top games share bars |
| `src/renderer/styles/admin/fleet.css` | All devices: devices table, device detail (the "All devices / Station 01" title path, games table), moderators table and editor, main admin PIN and sync grid; the one cloud sync rule (`.fleet-sync-error`) that `FleetSyncCard` also uses on the Device page |
| `src/renderer/components/admin/AdminKit.tsx` | React primitives |
| `src/renderer/components/admin/AdminScreen.tsx` | The shell, the `AdminThemeSwitch` and `data-admin-theme` |
| `src/renderer/components/admin/FilterPopover.tsx` | The filter button + panel (keyboard and controller handling) |
| `src/renderer/ui/preferences.ts` | The per-station theme preference (`useAdminThemePreference`, `useResolvedAdminTheme`) |

`src/renderer/styles.css` imports them in that order. Page files are
independent of each other: no page file uses another page's classes. Page CSS
only lays primitives out (column widths, one-off cells) and never restyles
them; anything a second page needs goes into the kit.

## Rules

- **Surfaces are flat and separated by tone.** `--a-bg` page, `--a-sidebar`,
  `--a-panel` for tables, stat rows and grouped forms (no outer border),
  `--a-tonal` for secondary buttons, chips, badges and filter buttons. No
  gradients, no glows, no card shadows. Only popovers and modals get a shadow
  (`--a-shadow-pop`) and a 1px `--a-line-strong` edge, because they float.
- **A panel holds a table, a grouped form or a list. Never nest panels.** The
  heading goes above the panel (`PageSection`), never inside it. A form panel
  ends in a full-width `.admin-panel-footer` (feedback left, button right).
- **Sections:** h2 (`--a-size-h2` Red Hat Display, display weight) + optional one-line description,
  16px gap, content. 40px between sections (`.admin-stack` or consecutive
  `PageSection`s). A list and its editor are two sections ("Saved plans" /
  "Edit plan", "Moderators" / "Add moderator", "Customer games" / "Add game").
- **Two-column pages:** main column + side column (`--a-side-column`,
  360-440px; `.admin-split`), which stacks below 1100px. Side columns hold
  short facts, never forms.
- **Widths:** content is left aligned. Form pages max 1240px; data pages
  (Games, Accounts, All devices, including the device detail) 1760px. Both
  1920×1080 and 1366×768 fit without horizontal page scroll; wide tables scroll
  inside `.admin-table-scroll` (at 1366 the Accounts sessions table does; its
  expanded row stays inside the visible width). Where a row of controls or a
  pair of tables no longer fits, it wraps or stacks (Accounts' search and sort
  take their own line, By device and Top games stack below 1600px, the Games
  editor's field pairs stack when the editor is under 620px) rather than
  shrinking text.
- **Type does the hierarchy, at the size staff are used to.** Text sizes come
  from the `--a-size-*` role tokens only. Each token is the 0.26.0 Control
  Room size for that role (set in Inter and Cascadia Mono, with the same
  viewport clamps) multiplied by an x-height ratio, so Red Hat's lowercase
  renders exactly as tall as it did in 0.26.0: `--a-x-match-text` 0.55/0.49,
  `--a-x-match-display` 0.55/0.50, `--a-x-match-mono` 0.52/0.49 (measured).
  Base sizes, before the ratio (rendered at 1920 in brackets):

  | Role | Token | 0.26.0 base |
  | --- | --- | --- |
  | Page title | `--a-size-title` | clamp(32px, 2.2vw, 40px) Display (44px) |
  | Modal title | `--a-size-modal-title` | 30px Display (33px) |
  | Sub-page title ("All devices / Station 01") | `--a-size-heading-lg` | clamp(24px, 1.6vw, 28px) Display (31px) |
  | Section heading (h2) | `--a-size-h2` | clamp(20px, 1.25vw, 23px) Display (25px) |
  | Sidebar "Control Room" | `--a-size-brand` | clamp(21px, 1.35vw, 26px) Display (28.5px) |
  | Accounts' hero figure (new in 0.27; sized to stay well above the stat values) | `--a-size-hero` | clamp(44px, 3.1vw, 56px) Display (62px) |
  | Stat values | `--a-size-figure` | clamp(24px, 1.8vw, 32px) Display (35px) |
  | Plan prices (plans table, customer preview) | `--a-size-price` | clamp(20px, 1.4vw, 24px) Display (26px) |
  | Accounts' quieter figures / a figure that is a name | `--a-size-figure-text` / `--a-size-figure-name` | clamp(24px, 1.8vw, 32px) / clamp(19px, 1.35vw, 24px) |
  | Empty-state title, update headline, plan names, logo name | `--a-size-lg` | 20px (22.4px) |
  | Running text, modal copy | `--a-size-body` | 17px (19px) |
  | Page description, loading line, modal description | `--a-size-lead` | 17px |
  | Nav items, Back to Home | `--a-size-nav` | 17px |
  | Inputs, selects, textareas | `--a-size-input` | 17px |
  | A row's name: games, devices, moderators, switch and value rows | `--a-size-row-title` | 17px |
  | Buttons | `--a-size-button` | 17px |
  | Compact buttons, segments, toggle chips, filter buttons, active filters | `--a-size-button-sm` | 15px (16.8px) |
  | Secondary text, section descriptions, table cells, notices, facts, status, scope note | `--a-size-small` | 15px |
  | Field labels, stat and figure labels, group titles (h3, `.admin-subheading`) | `--a-size-label` | 15px |
  | Help, captions, column headers, third lines, nav group labels, controller hints | `--a-size-caption` | 13px (14.6px) |
  | Badges, key caps | `--a-size-badge` | 12px (13.5px) |
  | IDs, payment IDs, paths (Red Hat Mono) | `--a-size-mono` | 15px Cascadia (15.9px) |

  To resize, change a base size in `tokens.css`, never a ratio, and never
  write a raw pixel font size in page CSS. **The owner asked for these sizes
  (the 0.26.0 sizes, measured against 0.26.0 screenshots): never shrink them
  without asking.** Heights and the paddings around text are sized for them
  (see the theme-independent tokens), so a smaller control would crowd the
  text.
- **Weights come from tokens, never literals** (only regular 400 is written
  as a number, because it is the same in both themes). Light-on-dark reads
  heavier, so the light theme steps every token up one notch:

  | Token | Dark / light | For |
  | --- | --- | --- |
  | `--a-weight-medium` | 500 / 600 | Field and row labels, column headers, buttons, segments, chips, badges, status words, stat and filter labels, nav group labels |
  | `--a-weight-strong` | 600 / 700 | Group titles (h3/h4, `.admin-subheading`: "Details", "Kiosk", "Games played"), the primary button, the chosen segment, the active nav item |
  | `--a-weight-display` | 600 / 700 | Red Hat Display: page, section, modal and sub-page titles, figures |

  The step matters most where a group title sits beside labels of the same
  size and colour (the Games editor's "Details" next to "Game title"): strong
  is always one notch above medium, in both themes.
- **Sentence case everywhere.** No uppercase and no letter-spacing, except
  keyboard key names (`.admin-kbd`).
- **Numbers are tabular in columns** (set on `.admin-screen`), proportional in
  big standalone figures (`.admin-stat-value`). Money and counts in tables are
  right aligned (`.admin-num`). Dates and times come from `fleetFormat`
  (`dateLabel` "14 Oct 2026", `timeLabel` "2:05 pm", `dateTimeLabel`,
  `relativeTime`), never from `toLocale*String` with the system locale.
- **States are words:** a status is `StatusText` (dot + label, colours below),
  a fact is a `Badge`, a count is plain `.admin-count` text ("8 saved",
  "4 of 5 on"). Never pills.
- **Facts lists have one alignment rule:** values right aligned only for short
  facts in a side column; anywhere wider, or when a value can be long (paths,
  IDs, errors, notes), the label column is fixed and values are left aligned
  (`.admin-meta-list--left`).
- **Focus:** `outline: 2px solid var(--a-accent); outline-offset: 2px`
  (`--a-focus`, `--a-focus-offset`) on everything focusable, for
  `:focus-visible` and `.controller-focused`, in both themes, including the
  controller-focused nav item. Fields also turn their border accent. No glow,
  no box-shadow ring. Hidden-checkbox controls (switch rows, inline switches,
  radio rows, picker options) outline the whole row or label. An element
  with its own focus look replaces the kit outline instead of adding a
  second ring (the timeline segments outline only the drawn bar, the game
  picker rows draw it inset, the device detail's back link sits at offset
  0); see Specificity for how.
- **Pending buttons, one rule for every page.** A text button never shows an
  icon or a spinner. While its action runs it is disabled and its label
  becomes the "-ing" form with three dots: "Saving...", "Checking...",
  "Refreshing...", "Retrying...", "Scanning...", "Adding...", "Deleting...",
  "Removing...", "Syncing...", "Rejoining...", "Restoring...", "Updating...",
  "Browsing...", "Downloading...", "Restarting...", "Exiting...". Keep the
  exact strings tests assert (`pending ? 'Saving...' : 'Save settings'`).
  Spinners remain only where there are no words to change: page and section
  loading lines (`LoadingState`), the update headline while it checks, an
  icon-only row button (the icon swaps for a spinner of the same size),
  and a table switch while its change saves (`InlineSwitch busy`, or beside
  the switch in the device detail's games table so the switch never moves).
- **Specificity: the kit stays low so pages can use one class.** The kit
  wraps `.admin-screen` in `:where()` wherever a page may need to restyle the
  thing:
  - headings: `:where(.admin-screen) :is(h1, h2, h3, h4)` is element
    weight, so `.fleet-detail-title` or `.update-headline` styles its heading
    with one class (no `.admin-screen .x` prefix);
  - focus: `:where(.admin-screen) :where(a[href], summary, [tabindex])` with a
    focus state is (0,1,0), so `.x:focus-visible` replaces it; buttons are
    (0,2,1) because they must replace the console's global button focus ring
    (box-shadow, outline none) at the same weight, so a page overrides with
    `.x:not(:disabled):is(:focus-visible, .controller-focused, .focused)`;
  - checkbox and radio focus: (0,2,1), replaced by `.row > input:focus-visible`;
  - the expanded table row's padding has no `:hover` twin, so a page's
    `tbody tr.x td` padding holds under the pointer.

  Primitives a page lays out but must not restyle (`.admin-btn`, inputs,
  `.modal`) keep `.admin-screen` in front; a page that only adds a width or a
  margin to one of them needs no prefix either (`.game-browse`, `.scan-add`).
- **Motion:** colour/background transitions up to 120ms. No scale, lift, glow,
  shimmer or entrance animation.

## Status colours

Red is deliberately an orange-red (hue about 12°) so it never reads as the NXGS magenta accent (hue about 333°); a "Missing" status next to an "on" switch must look different at a glance. Keep that separation if either colour changes.

One mapping for every page. Pick the tone by what the state means, not by the
page it is on. Each colour has a dark-theme and a light-theme value (the light
ones are darker so they keep 4.5:1 on white and on their tints).

| Tone | Token | Dark / light | Means | Used for |
| --- | --- | --- | --- | --- |
| `success` | `--a-green` | `#3ecf8e` / `#137246` | Done, healthy, on, verified | Completed session, Active device / moderator, Available game, Verified payment (check icon), Synced, Ready (scan), In library, Registered / Supported / Yes (diagnostics), update installed or latest |
| `info` | `--a-blue` | `#7aa7ff` / `#2457c5` | Live, in progress, new | Playing session, Syncing..., Live diagnostics, a game running or launching (diagnostics), update available |
| `warning` | `--a-amber` | `#f5a524` / `#945300` | Waiting or needs a look | Pending, Waiting for device, Waiting to sync, Unfinished session, Not verified, Needs confirmation, Rejoin needed, Not registered, a lockdown flag off while customers use the device |
| `danger` | `--a-red` | `#ff6b4a` / `#b93815` | Failed, missing, removed | Failed / Sync failed, Missing game, Removed device, Removed by main admin, errors |
| `neutral` | `--a-text-3` dot, `--a-text-2` label | | Off, over, or not known | Inactive, Disabled, Time up, Interrupted, Not checked, Not set up, Idle, Local only, Unsupported |

The accent is not a status colour: never use magenta for a state.
`Badge` tones follow the same table; a plain badge ("This device", "Global",
"Custom") is a fact, not a state. `Stat` values are coloured only when that
carries meaning.

## Tokens (`.admin-screen` only)

Colour tokens (dark / light):

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--a-bg` | `#111015` | `#f5f4f7` | Page background |
| `--a-sidebar` | `#151419` | `#efedf2` | Sidebar |
| `--a-panel` | `#19181e` | `#ffffff` | Tables, stat rows, grouped forms, popovers, modals |
| `--a-panel-2` | `#211f27` | `#f1eff4` | Row hover, selected rows, picker hover |
| `--a-inset` | `#0e0d12` | `#faf9fb` | Expanded table rows |
| `--a-tonal` / `--a-tonal-hover` | `#24222b` / `#2e2b36` | `#e9e6ee` / `#dfdbe5` | Secondary buttons, toggle chips, badges, filter buttons, segmented track, active-filter chips, key caps |
| `--a-nav-hover` | `#1e1c24` | `#e5e2ea` | Nav item hover and focus |
| `--a-logo-tile` | `#0e0d12` | `#18161d` | The brand logo's tile (dark in both themes) |
| `--a-field` / `--a-field-hover` | `#0e0d12` / `#15141a` | `#ffffff` / `#faf9fb` | Input, select, textarea fill |
| `--a-field-line` / `--a-field-line-bottom` | `#34313c` / `#6a6675` | `#dcd8e2` / `#8f8a99` | Field border (sides and top / bottom, 3:1) |
| `--a-control-border` | `#6a6675` | `#8a8693` | Unchecked checkbox and radio |
| `--a-switch-off` / `-hover` / `--a-switch-knob` | `#3d3a46` / `#4a4654` / `#efedf3` | `#c4bfcc` / `#b3adbc` / `#ffffff` | Switch track off, hover; knob; scrollbar thumb |
| `--a-line` / `--a-line-strong` | `#2a2830` / `#3a3742` | `#e3e0e8` / `#cfcbd6` | Hairlines between rows / popover and modal edges |
| `--a-text` / `-2` / `-3` | `#efedf3` / `#a7a3b0` / `#8e8a98` | `#18161d` / `#5d5966` / `#6a6674` | Primary / secondary / tertiary text |
| `--a-inverse` | `#111015` | `#ffffff` | Text on a solid red (confirm delete) |
| `--a-accent` | `#ff4fa3` | `#c2185b` | NXGS magenta: primary fill, active nav bar, focus, links, switch on, checked boxes, selected-row bar |
| `--a-accent-strong` | `#ff79b9` | `#a3134c` | Primary hover, link hover, text on an accent tint |
| `--a-on-accent` | `#1a0710` | `#ffffff` | Text and check marks on the accent |
| `--a-accent-tint` / `-tint-faint` / `-line` | magenta at 14% / 7% / 50% | magenta at 12% / 7% / 45% | Selected segment and chip, active filter / active nav fill / selected chip edge |
| `--a-green` `--a-amber` `--a-red` `--a-blue` | see Status colours | | Meaning only |
| `--a-*-tint` | hue at 12% | hue at 10% | Notice, badge and danger button backgrounds |
| `--a-red-tint-strong`, `--a-red-strong` | red 20%, `#ff8a70` | red 16%, `#972c0e` | Danger hover |
| `--a-red-line` | red at 40% | red at 40% | Danger zone hairline |
| `--a-neutral-tint` | text at 5% | text at 4% | Neutral notice |
| `--a-scrim`, `--a-shadow-pop` | | | Modal backdrop; popover and modal shadow |
| `--a-weight-medium` / `-strong` / `-display` | 500 / 600 / 600 | 600 / 700 / 700 | Font weights (see Rules: weights come from tokens) |

Theme-independent tokens:

| Token | Value | Use |
| --- | --- | --- |
| `--a-radius` / `-sm` / `-xs` | 4px | Panels, popovers, modals, inputs, buttons, badges, chips |
| `--a-radius-inner` | 2px | Segments inside a segmented track |
| `--a-font-display` | Red Hat Display | Page title, section and modal headings, figures, sidebar brand |
| `--a-font` | Red Hat Text | All UI text |
| `--a-font-mono` | Red Hat Mono, Cascadia Mono, Consolas | IDs, payment IDs, paths, key names |
| `--a-size-*` | see Rules: type | One token per text role, 0.26.0 base size × x-height ratio |
| `--a-focus-color`, `--a-focus`, `--a-focus-offset` | accent, `2px solid`, 2px | Focus outline |
| `--a-dur`, `--a-ease` | 120ms | Colour transitions |
| `--a-control` / `--a-control-sm` / `--a-input` | 48 / 40 / 48px | Buttons and header actions / compact buttons, segments, chips, filter buttons, row actions / inputs, selects and the segmented track |
| `--a-row` / `--a-header-row` | 56 / 44px | Table rows / column header |
| `--a-setting-row` / `--a-list-row` | 66 / 68px | Switch, value and radio rows / list rows with a thumbnail (Games library) |
| `--a-nav-item` / `--a-brand-logo` | clamp(40px, 5.2vh, 54px) / clamp(36px, 4.2vh, 46px) | Sidebar nav items / logo tile |
| `--a-thumb` / `--a-icon` / `--a-icon-sm` / `--a-check` | 44 / 20 / 18 / 20px | Game artwork square / icons in buttons and hint glyphs / icons in compact buttons, fields, notices / checkboxes and radios |
| `--a-btn-pad-x` / `--a-btn-pad-x-sm` / `--a-field-pad-x` | 20 / 14 / 14px | Horizontal padding in buttons / compact buttons and chips / fields |
| `--a-panel-pad` / `--a-modal-pad` | clamp(22px, 1.6vw, 28px) / 32px | Panel padding (and footer, stat cells) / modal padding |
| `--a-cell-pad-x` / `--a-cell-pad-edge` | 14 / 20px | Table cell padding / first and last cell from the panel edge |
| `--a-sidebar-width` | clamp(248px, 17vw, 320px) | Sidebar (the 0.26.0 width) |
| `--a-page-pad-top` / `--a-page-pad-x` / `--a-page-pad-bottom` | clamp(24px, 3.6vh, 40px) / clamp(32px, 2.8vw, 56px) / 64px | Content padding |
| `--a-page-max` / `--a-page-max-data` / `--a-side-column` / `--a-section-gap` | 1240 / 1760 / clamp(360px, 24vw, 440px) / 40px | Layout |

**Console token bridge.** The last block of `tokens.css` re-points the global
console tokens inside `.admin-screen` only: `--ps-*` surfaces/text/status
(`--ps-blue*` become the accent), `--panel-*`, `--text-primary/secondary`,
`--font-ui` / `--font-display` (Red Hat), `--radius-*` (pill becomes 4px),
`--text-*`, `--focus-*` and `--focus-ring*` (2px accent, no glow),
`--hover-ring`, `--shadow-1/2` (none), `--dur-*` (120ms), the slider and
controller glyph colours. It exists for the shared pieces the Control Room
renders (base inputs and buttons, the modal shell, `ControllerHints`,
`.ps-switch`) and makes them follow the theme. **Never use those names in
admin CSS; use `--a-*`.**

## Shell (AdminScreen)

- Sidebar (`--a-sidebar-width`, 248-320px): the logo on a dark tile +
  "Control Room" (`--a-size-brand`, Red Hat Display) + device name; nav items
  are `--a-size-nav` at `--a-nav-item` height, so all ten fit at 1366×768
  with the footer; nav groups *Library* (Games, Scan), *This device* (Sessions,
  Plans, Details, Branding, Kiosk, Updates), *Business* (Accounts, All
  devices). Nav items are text only, aligned with the group label; the active
  item has a 2px accent bar, strong-weight text and a faint accent tint; hover and
  keyboard/controller focus use `--a-nav-hover` plus the accent outline.
  `ADMIN_TABS` follows the sidebar order, so arrow keys and the D-pad move
  through it top to bottom. Footer, top to bottom: the theme switch (Dark ·
  Light · System, see Themes), "Back to Home" (ghost, no icon) and one line of
  controller hints.
- Page header: `PAGE_COPY[tab]` title (`--a-size-title` Red Hat Display) and
  description (`--a-size-lead`), then the scope note (`--a-size-small`),
  always present so every header has the same height:
  "Applies to Station 01", "Earnings from Station 01" (Accounts, this
  device), "Earnings from every device" (Accounts, all devices) or "Covers
  every device" (All devices). The actions slot sits on the right, then (main
  admin pages, while unlocked) the "Main admin unlocked · Lock" chip after a
  hairline. A hairline closes the header.
- `DATA_TABS` (games, accounts, fleet) get the 1760px container.
- Kept behaviour: `data-admin-tab` on nav buttons, `.controller-focused` on the
  focused nav item, Escape/B closes (not from inputs or an open
  `[data-admin-popover]`), arrows stay inside `[data-admin-local-keys]` (the
  theme switch is one), the main admin is locked on unmount, `{owner.dialog}`
  (PinDialog) renders in the Control Room, `data-admin-theme` on the root.

Put page-level actions (Refresh, Export, Add) in the header with
`<PageActions>`, as 48px text buttons without icons; section-level actions
(Sync now, View earnings) are 40px buttons in the section header:

```tsx
import { PageActions } from './AdminKit';

<PageActions>
  <button className="admin-btn" type="button" onClick={refresh}>Refresh</button>
  <button className="admin-btn admin-btn--primary" type="button" onClick={exportCsv}>Export CSV</button>
</PageActions>
```

### Sub-pages: the title path is the way back

A page that opens one item of a list in place (the device detail on All
devices) does not get a back arrow, a "Back" button or a breadcrumb bar. Its
heading reads as a path in one Red Hat Display line (`--a-size-heading-lg`),
**"All devices / Station 01"** (`.fleet-detail-path` in `fleet.css`):

- the first part is the way back: a real `<button>` (keyboard, controller,
  `onBack`) in `--a-text-2` at the regular weight, `--a-text` and underlined
  on hover, its focus outline at offset 0 so it stays clear of the separator;
- the separator `/` is `--a-text-3` and `aria-hidden`;
- the item name is the heading (`h2.fleet-detail-title`, display weight),
  with its badges ("This device") in body type after it;
- status and place sit on one line under the path; the page's own actions
  (View earnings) sit right of it, and Refresh stays in the page header.

The shell's page title and scope note do not change ("All devices", "Covers
every device"). The form for the item's own fields is the section **"Edit
details"** on both the Device page and the device detail, because the page
title already says "Device details" (on the device detail the facts beside
it are the section "Device").

## Primitive catalogue

Import components from `components/admin/AdminKit.tsx`. Classes are in
`kit.css`.

### PageSection — titled block of a page

`<section class="admin-section">` with `.admin-section-header`,
`.admin-section-heading` (h2), `.admin-section-description`, `.admin-section-actions`.

```tsx
<PageSection title="Saved plans" description="Enabled plans are offered to customers at checkout." actions={<span className="admin-count">4 saved</span>}>
  <div className="admin-table-scroll">...</div>
</PageSection>
```

### Panel — the one raised surface

`.admin-panel` (`--a-panel-pad` padding, `--a-panel` fill, no outline: a transparent 1px
border keeps the geometry). `padding="none"` (`.admin-panel--flush`) for
edge to edge lists; `padding="rows"` (`.admin-panel--rows`, 4px `--a-panel-pad`) for a
panel of hairline rows: switch rows, value rows, a facts list. Other props:
`as` (`div`, `section`, `form`, `ul`, `ol`), any HTML attribute, `ref`.

```tsx
<Panel as="form" className="admin-form" onSubmit={save}>...</Panel>
<Panel padding="rows"><div className="admin-switch-list">...</div></Panel>
```

### Panel footer — feedback and the save button

`.admin-panel-footer`: full-width strip under a hairline at the bottom of a
panel (works in default, flush and rows panels), notice on the left, the last
button pushed right. The Games editor adds `.game-editor-footer` to make it
sticky.

```tsx
<footer className="admin-panel-footer">
  {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
  <button className="admin-btn admin-btn--primary" type="submit">Save device</button>
</footer>
```

### Toolbar, ToolbarSpacer — a row of controls

`.admin-toolbar` (10px gap, wraps), `--end`, `--between`; `.admin-toolbar-spacer`.

```tsx
<Toolbar aria-label="Device filters">
  <span className="admin-affix-input"><Search size={15} aria-hidden="true" /><input placeholder="Name, store, location or device ID" /></span>
  <ToolbarSpacer />
  <span className="admin-count">6 devices · 5 active</span>
</Toolbar>
```

### Buttons — classes only

`.admin-btn` + `--primary` (accent fill, `--a-on-accent` text, strong weight; hover
`--a-accent-strong`; never white), `--secondary` (the default: tonal
`--a-tonal` fill, no outline), `--ghost` (text only, `--a-text-2`; tonal on
hover), `--danger` (red text on a red tint, stronger on hover); 48px with
`--a-size-button` text and 20px side padding, sizes `--sm` (40px,
`--a-size-button-sm`, 14px padding) and `--icon` (square, combine with
`--sm`). Every variant keeps a
transparent 1px border so they line up. Add `.confirming` to a danger button
for the second click of a two-step delete (solid red, labelled with the
action: "Delete", "Remove device"; Cancel beside it). Ghost danger
(`--ghost --danger`) stays grey until hover: use it for row delete icons.
Text buttons have no icon and no spinner: while busy they are disabled and
read "Saving..." (see Pending buttons). Icon-only buttons (the kit sizes any
`svg` in an `.admin-btn` to 20px, 18px in a compact one) are for row actions
(delete, copy, reorder, close) and need an `aria-label`; while busy the icon
becomes a spinner of the same size. Header actions and form footers are 48px;
section, table and toolbar actions 40px. One primary button per view.

```tsx
<button className="admin-btn admin-btn--primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save device'}</button>
<button className="admin-btn admin-btn--sm" type="button">Sync now</button>
<button className="admin-btn admin-btn--icon admin-btn--sm admin-btn--ghost admin-btn--danger" type="button" aria-label={`Delete ${game.title}`}><Trash2 size={16} /></button>
```

### Field and inputs

`Field` renders `.admin-field` with `.admin-field-label` (`--a-size-label`, medium),
`.admin-field-required`, `.admin-field-help` / `.admin-field-error` (`--a-size-caption`).
With `htmlFor` the label points at the control; without it the label wraps the
control. `error` replaces the help text and turns the control border red.
`.admin-field-help` is also the class for a short standalone note in a form or
side column ("Use 6 or more digits...").

Inputs, selects and textareas are styled by element inside `.admin-screen`:
48px with `--a-size-input` text and 14px side padding, filled (`--a-field`: the inset tone in dark, white in light), a subtle
1px `--a-field-line` border that is heavier at the bottom
(`--a-field-line-bottom`), hover `--a-field-hover`; on focus the border turns
accent and the accent focus outline appears. Checkboxes and radios are 20px;
checked ones are accent with an `--a-on-accent` mark. Native pickers and the
select list follow the theme through `color-scheme`.

```tsx
<Field label="Device name" required error={nameError}>
  <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
</Field>
```

Also: `.admin-affix-input` (input with a leading search magnifier, or a unit
word before or after it in an `<em>`: "₹", "min", "sec", or the "Sort" label;
the same filled frame; the inner input/select loses its own frame, the
wrapper shows focus; no other icons in fields),
`.input-with-button`, `.form-grid` (two columns, `.full` spans both),
`.admin-form` (24px rhythm).

### SwitchRow — on/off setting

`.admin-switch-row` (66px: `--a-size-row-title` title and `--a-size-small`
description left, 40×24 switch right). Wrap several in
`.admin-switch-list` for hairlines between rows, inside a `padding="rows"`
panel. `.admin-value-row` is the same row with a value control (a PIN input,
seconds). The switch itself is `.ps-switch[data-on]`: `--a-switch-off` track
when off, the accent when on, a `--a-switch-knob` knob; it is the only
rounded-full element.

```tsx
<Panel padding="rows">
  <div className="admin-switch-list">
    <SwitchRow label="Always on top" description="Keep NXGS Play above other apps." checked={kiosk.alwaysOnTop} onChange={(checked) => update('alwaysOnTop', checked)} />
  </div>
</Panel>
```

`.admin-row-actions` groups the controls on the right of a value row (a PIN
input and its button, Cancel + Confirm).

### Danger zone — destructive actions

A `Danger zone` section holding a `padding="rows"` panel with
`.admin-danger-zone` (the one panel with an outline: a red 40% hairline, no
red fill); each action is a value row:
label and consequence on the left, the danger button on the right. A second
click confirms (`.confirming`, with Cancel beside it). Used for Exit NXGS Play
(Kiosk) and Remove device (All devices).

```tsx
<PageSection title="Danger zone">
  <Panel padding="rows" className="admin-danger-zone">
    <div className="admin-value-row">
      <span className="admin-switch-copy"><strong>Remove device</strong><small>Sessions and earnings stay in Accounts...</small></span>
      <span className="admin-row-actions"><button className="admin-btn admin-btn--danger" type="button">Remove device</button></span>
    </div>
  </Panel>
</PageSection>
```

### InlineSwitch — a switch in a table cell or toolbar

`.admin-inline-switch`: the bare 40×24 switch with an optional label after it
and an optional spinner (`busy`). The checkbox is hidden; the label shows the
focus outline. Used by the Plans "Enabled" column, the device detail's games
"On" column and Accounts' "Verified payments only".

```tsx
<InlineSwitch checked={plan.enabled} disabled={busy} busy={toggling} aria-label={`${plan.name} on customer payment screen`} onChange={() => toggle(plan)} />
<InlineSwitch checked={view.verifiedOnly} label="Verified payments only" onChange={setVerifiedOnly} />
```

### Segmented — one choice out of a few

`.admin-segmented`: a tonal track (no outline) as tall as an input (48px),
40px segments; the chosen
segment gets the accent tint, a 1px inset accent edge and
`--a-accent-strong` text at the strong weight (unchosen segments are
`--a-text-2` at the medium weight). Buttons carry `aria-pressed` (or
`role="radio"` + `aria-checked`, like the theme switch). Segments are text
only: `SegmentedOption` has no icon.

```tsx
<Segmented aria-label="Period" value={period} onChange={setPeriod} options={[
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' }
]} />
```

### ToggleChip — on/off filter

`.admin-chip-toggle[aria-pressed]` (40px, `--a-size-button-sm`, radius 4, tonal fill; selected:
accent tint, `--a-accent-line` edge, `--a-accent-strong` text and a leading
check drawn by CSS, the same mark the picker's "Whole store" toggle uses, so
no toggle carries an icon element). Group in `.admin-chip-toggles`.

```tsx
<div className="admin-chip-toggles" role="group" aria-label="Device status">
  <ToggleChip pressed={states.includes('active')} onChange={() => toggle('active')}>Active</ToggleChip>
</div>
```

### Badge — a fact about a row

`.admin-badge` (26px, radius 4, `--a-size-badge` medium, tonal fill, no outline,
`--a-text-2`) and `--success`, `--warning`, `--danger`, `--info` (the
semantic tint and colour). For "This
device", "Global", "Custom", "Device admin only". Not for counts or live states.

### StatusText — a state in words

`.admin-status` + `--neutral|success|warning|danger|info`: 8px dot + `--a-size-small`
label in the theme's semantic colour (mapping above). The label is the only
baseline-aligned item, so a status sits exactly on the text baseline of a table
cell or facts row; no page needs a `vertical-align` or row-centring fix.
`icon` replaces the dot where a mark says more (the verified check).

```tsx
<StatusText tone={session.status === 'completed' ? 'success' : 'neutral'}>{statusLabel}</StatusText>
<StatusText tone="success" icon={<Check size={14} aria-hidden="true" />}>Verified</StatusText>
```

### StatRow + Stat — key figures

`.admin-stat-row` is one panel (no outline) split into equal cells by
hairlines (wraps cleanly; `minCellWidth` sets the wrap point, default 200px).
Each `.admin-stat`: `.admin-stat-label` (`--a-size-label`), `.admin-stat-value` (`--a-size-figure`
Red Hat Display, proportional figures, ellipsis), optional `.admin-stat-sub`
(`--a-size-caption`). The same figure has the same label on every
page ("Games on device", "Paid sessions", "Revenue"). No icons.

```tsx
<StatRow aria-label="Device figures" minCellWidth={150}>
  <Stat label="Paid sessions" value={sessions} />
  <Stat label="Revenue" value={formatPaise(revenue)} />
</StatRow>
```

### Table — classes only

`.admin-table-scroll` is the panel (tone, no outline) and the scroller;
`.admin-table` inside: sticky 44px header (`--a-size-caption` medium `--a-text-2`), 56px
rows of `--a-size-small` text (a row's name `--a-size-row-title`), 14px cell
padding, hairline row separators only, 20px from the panel edge on both sides,
hover `--a-panel-2`, `.admin-num` for right aligned numbers.

- `tr.is-clickable`: the row opens, expands or picks something on click
  (pointer cursor). The row also holds a real button for keyboard and
  controller (device name, expand toggle, Edit).
- `tr.is-selected`: the row being edited or picked: `--a-panel-2` fill and a
  2px accent bar on the left edge, like the nav and the Games list.
- `tr.admin-table-detail`: the expanded row (`--a-inset`, 20px padding,
  hovered or not). A page that needs other padding sets it with a selector of
  the same weight (`.accounts-table tbody tr.accounts-detail-row td`); there is
  no `:hover` rule to match, so the row never shifts under the pointer.

```tsx
<div className="admin-table-scroll" data-admin-local-keys="true">
  <table className="admin-table">
    <thead><tr><th scope="col">Started</th><th scope="col" className="admin-num">Amount</th></tr></thead>
    <tbody>
      <tr className={`is-clickable${open ? ' is-selected' : ''}`} onClick={toggle}>...</tr>
      <tr className="admin-table-detail"><td colSpan={2}>...</td></tr>
    </tbody>
  </table>
</div>
```

### Notice — inline feedback

`.admin-notice--success|error|warning|info`: 2px left rule in the semantic
colour on its tint, `--a-size-small`, 18px icon inline (the icon carries meaning). `role="alert"` for errors.

```tsx
<Notice tone="error">{error}</Notice>
```

### EmptyState — nothing to show

`.admin-empty`: left aligned `--a-size-lg` medium title, `--a-size-small` text, optional
`action`. No icons. In a padded panel it uses the panel's padding; in a table scroller or
flush panel it keeps the rows' 20px inset.

```tsx
<Panel>
  <EmptyState title="No plans saved">Add a plan to make play-time checkout available to customers.</EmptyState>
</Panel>
```

### LoadingState — waiting

`.admin-loading`: 18px spinner + `--a-size-lead` text, inline, left aligned.

### Facts list — label/value pairs

`<dl class="admin-meta-list"><div><dt/><dd/></div></dl>`: hairline rows on the
text baseline (`--a-size-small`, 13px row padding). Default: label left, value right, for short facts in a
side column (Device page identity, device detail). `.admin-meta-list--left`: a
210px label column (`--a-meta-label`) and left aligned values, for facts in a
main-column panel or values that can be long (cloud sync, local storage
paths, update facts, diagnostics). Put it in a `padding="rows"` panel when it
has a frame.

### List rows — `.admin-list > .admin-list-row`

Hairline rows (68px, a 44px thumbnail, `--a-size-row-title` name and
`--a-size-small` second line) inside a flush panel (the Games library); `.row-main` is the
clickable part; `.selected` adds the `--a-panel-2` fill and the 2px accent
bar. Use a table for data.

### FilterPopover, pickers, active filters

`FilterPopover` (`FilterPopover.tsx`) is a filter button (`.admin-popover-trigger`,
a tonal chip with a chevron that reads "Devices | 3 devices" once active, then
styled like a selected chip) and a panel under it (`.admin-popover-panel`:
`--a-panel`, 1px `--a-line-strong`, radius 4, the pop shadow). The panel carries `data-admin-popover` while open
so Escape/B close it, not the Control Room. Inside, a picker:
`.admin-picker-head` (search + status line with Select all / Clear),
`.admin-picker-list` > `.admin-picker-group` (`.admin-picker-group-header`:
the store name, `--a-size-caption` medium `--a-text-3`, and a "Whole store" ghost toggle
with `aria-pressed`; on, it reads in `--a-text` with the chips' CSS check, no
icon element) > `.admin-picker-option` rows (48px,
checkbox, `.admin-picker-name`, `.admin-picker-meta`, optional badge; keyboard
focus outlines the row). Active filters show as `.admin-active-chip` buttons
("Device Station 01 ×", tonal) in the result line under a filter bar.

### Modal

Control Room modals reuse `.modal-backdrop > .modal` from dialogs.css; inside
`.admin-screen` they are flattened and themed (`--a-scrim` backdrop, panel
fill, 1px `--a-line-strong` edge, radius 4, pop shadow, 32px padding,
`--a-size-modal-title` Red Hat Display heading, `--a-size-body` copy). Render them inside the page component so they stay
inside `.admin-screen`. A close button is
`admin-btn admin-btn--icon admin-btn--ghost close-button`: the kit pins it to
the top right corner of every modal. The PinDialog is portaled outside and
keeps its own console look (dark) in both themes.

**A list inside a modal runs edge to edge** (the installed game picker,
`.installed-game-list` in `library.css`): no frame of its own, it spans the
modal's full width between two hairlines (`margin-inline` minus `--a-modal-pad`), rows are
separated by hairlines, a sticky column header sits on the same panel tone,
and every column lines up with the modal's 32px content edge. Keyboard and
controller focus draw the outline inside the row (`outline-offset: -2px`)
so the scroller never clips it. Do not put a framed table or a panel inside
a modal.

### Type and layout helpers

| Class | Purpose |
| --- | --- |
| `.admin-subheading` | `--a-size-label` Red Hat Text at the strong weight: a group title inside a section or panel ("Details", "Kiosk", "Games played"), one notch above the labels beside it |
| `.admin-text-2`, `.admin-caption` | Secondary colour; `--a-size-caption` caption |
| `.admin-count` | `--a-size-small` `--a-text-2` count or short meta next to a heading or toolbar ("8 saved", "4 of 5 on", "Last scan 2:05 pm") |
| `.admin-num` | Tabular, right aligned, no wrap |
| `.admin-mono` | `--a-size-mono` Red Hat Mono, selectable (IDs, payment IDs, paths) |
| `.admin-kbd` | Keyboard key name in Red Hat Mono on a tonal key cap: filled `--a-tonal`, no edge line, in both themes (the one uppercase) |
| `.admin-visually-hidden` | Screen-reader-only text |
| `.admin-stack` | Vertical 40px rhythm between sections |
| `.admin-split` | Main + side column (`--a-side-column`), stacked below 1100px |

### Other exports

- `ArtImage`: image with a fallback node.
- `revealInContent(element)`: scrolls an editor into view inside `.admin-content`.
- Types: `NoticeTone`, `Tone`, `SegmentedOption`, `PanelProps`.

## Copy

- **Sentence case** for every title, label, button and status ("Save
  settings", "Last resume result"). Proper names keep their capitals (Home,
  Control Room, NXGS Play, Razorpay, Microsoft Store), as do key names.
- **"Device", never "station"**, in staff-facing copy: "this device", "Device
  details", "device admin PIN", "This device" (nav group, badge, scope). Station
  01 is just the default device name. Code identifiers (`stationId`) stay.
- **Name sections as the nav does:** Games, Scan, Sessions, Plans, Device,
  Branding, Kiosk, Updates, Accounts, All devices ("managed from Plans",
  "rejoins from its own Device page", "Remove Station 01 from All devices?").
  The old names (Plan Manager, Device Manager, Device Management) are gone.
- **Roles:** the main admin (owner PIN, every device), the device admin (each
  device's admin PIN), moderators (their own PIN on the devices they are given).
- **One label per concept** across pages: the same form field, figure or state
  reads the same everywhere ("Store / branch name", "Device location",
  "Paid sessions", "Revenue", "Not checked").
- **No subtitle that restates the title.** A description adds what the title
  does not say, or is left out.
- Status words in the tables above. Pending buttons read "-ing" plus three
  dots ("Saving...", "Refreshing..."; see Pending buttons). The second click
  of a two-step delete names the action ("Delete", "Remove device"), never
  "Confirm" or "OK".
- An item's own form is "Edit details"; the list and its editor are two
  sections named for what they hold ("Saved plans" / "Edit plan",
  "Moderators" / "Add moderator").

## Don'ts

- No literal colours (hex, `rgb()`, named) in component or page CSS; only
  `--a-*` tokens that both themes define. No literal font weights other than
  400; use `--a-weight-medium`, `--a-weight-strong`, `--a-weight-display`.
- No white primary button, no second accent (no cyan, no blue links), no
  gradients of the brand colours.
- No icons in the nav, in text buttons, segments, field labels, headings or
  header actions, and no spinner in a text button (its label changes
  instead). Icon-only row actions keep their icon and an `aria-label`.
- No eyebrows (small uppercase label over a title).
- No icons in tinted circles or rounded squares: not in nav, headers, stat
  tiles, empty states or list rows.
- No pills for statuses, counts or tags; no `border-radius: 999px` except the
  switch; no radius above 4px.
- No outlines around panels, tables, stat rows, buttons, chips or badges;
  separate by tone. Outlines are for the danger zone, a selected chip,
  floating surfaces and focus.
- No glows, halos or coloured box-shadow rings; focus is the outline.
- No gradients, blue-tinted surfaces or card shadows.
- No uppercase or letter-spacing (key names excepted); no heading inside a
  page larger than the section heading (`--a-size-h2`): only the page title,
  the sub-page title and modal titles are larger.
- No shrinking text, controls or rows below the role tokens to fit something
  in: wrap, stack or let a table scroll inside its panel instead. The owner
  asked for the 0.26.0 sizes.
- No nested panels, no card-in-card "sections", no section heading (h2)
  inside a panel; a group title (`.admin-subheading`) inside one is fine.
- No huge numbers with an icon badge as KPI tiles; use `StatRow`.
- No decorative icons (trophies...).
- No scale/lift/shimmer/entrance animations, no `transform` hover effects.
- No colour outside the status mapping; no second status style for the same
  state on another page.
- No `--ps-*`, `--radius-*`, `--focus-ring` or other console tokens in admin
  CSS; no page CSS that restyles a primitive or reuses another page's classes.
- No `.admin-screen .x` prefix in page CSS just to out-rank a kit heading,
  focus or expanded-row rule; those are kept low (see Specificity) so one
  class wins.
- No admin UI portaled outside `.admin-screen` (it would lose the theme).

## Adding to a page

1. Build it from `PageSection` + `Panel` (+ `.admin-panel-footer` for a form),
   tables with `.admin-table-scroll`, facts with `.admin-meta-list`.
2. States are `StatusText` with the mapped tone, facts `Badge`, counts
   `.admin-count`.
3. Labelled controls use `Field`; buttons use `.admin-btn` classes; page-wide
   actions go into `<PageActions>`.
4. Put only layout in the page's CSS file, with `--a-*` tokens (never a
   literal colour). If you need a look the kit does not have and a second
   page will need it, add it to the kit and this catalogue.
5. Keep behaviour, keyboard/controller support and copy meaning. Tests in
   `scripts/verify-*.mjs` read component source and assert some strings (for
   example "Main admin unlocked", "Only games linked to", "Saved results will
   belong to", "Play durations and prices are managed from Plans.", "Allow free
   play", `'Save settings'`, `<th scope="col">Customer</th>`). If you change an
   asserted string, update the assertion and keep what it protects.
6. Check 1920×1080 and 1366×768 in both themes: no horizontal page scroll,
   focus visible on every control, Escape/B still closes the Control Room.

Checks: `npx tsc --noEmit`, `npm run test:accounts`, `test:fleet-ui`,
`test:fleet-backend`, `test:device-manager`, `test:plan-manager`,
`test:free-play`, `test:console-language`, `test:back-navigation`,
`test:controller-navigation`, `test:controller-bridge`, `test:controller-idle`,
`test:home-hero`, `test:launch-flow`, `test:close-flow`,
`test:secret-admin-shortcuts`, `test:home-overlay`.
