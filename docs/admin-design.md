# Control Room design system

The Control Room (`src/renderer/components/admin/AdminScreen.tsx` and every page
it renders) is a calm, modern operator console for a gaming café, in a dark or
a light theme, in the idiom of current system settings apps (macOS / iOS
System Settings, Raycast, Linear): layered surfaces, grouped inset lists in
rounded containers, radius by role, a sticky translucent page bar, quiet
motion. Hierarchy comes from type first, then from those surfaces; never from
decoration. One brand accent, NXGS magenta, marks what is chosen or
actionable; other colour only carries meaning (status, verified money,
errors). Text is set at the size staff knew from 0.26.0 (see Rules: type),
with generous controls around it: inputs and buttons are 48px high (only the
compact controls the kit defines, small buttons, segments, toggle chips,
filter buttons and the inline switch, are 40px), and focus is always a
visible accent ring, because staff may drive it with a controller.

Customer surfaces (Home, Settings, the quick menu, PinDialog,
AdminOptionsDialog...) are out of scope: they keep Inter and the console look.
Nothing here touches `:root` tokens.

## Identity

What makes it NXGS rather than a default component theme:

- **One accent, NXGS magenta** (from the logo's neon; the logo runs cyan to
  magenta, but the Control Room uses magenta only, never both and never a
  gradient). It is used sparingly and only for: the primary button fill, the
  active nav item (tint + icon), the focus ring, selected toggle chips and
  active filters (tint + accent text), checked boxes and radios, links, the
  switch "on" track, the selected row's faint tint, and the hero figure's
  small marker in Accounts. A chosen segment is *not* accent: it is raised
  above its track. Text on an accent tint uses `--a-accent-strong` (or
  `--a-text`, as the active nav item does); text on the accent fill uses
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
- **Shape: radius by role, concentric when nested.** Panels, grouped lists,
  tables, stat rows, standalone facts lists, popovers and modals 14px
  (`--a-radius-panel`); buttons, inputs, selects, the segmented track, nav
  items, notices and row highlights 10px (`--a-radius-control`); segments
  inside a track 8px (`--a-radius-segment`); toggle chips, filter buttons,
  active-filter chips and picker rows 8px (`--a-radius-chip`); badges, key
  caps, checkboxes and thumbnails 6px (`--a-radius-badge`); thin bars (the
  timeline strip, share bars) 2px. A row highlight sits 4px inside its 14px
  container (`--a-row-inset`), so its 10px corners run parallel to the
  container's. The switch track is the only rounded-full element.
- **Grouped inset lists (the core pattern).** Settings rows, facts lists,
  tables and forms sit in rounded containers on the raised panel surface.
  Separators are inset hairlines that start and end at the rows' text, never
  edge to edge; a hovered, focused or selected row is a rounded highlight 4px
  inside the container (so the first and last rows follow its corners), and
  the hairlines next to it hide.
- **Depth: layered surfaces.** Page `--a-bg` < `--a-sidebar` < `--a-panel` <
  `--a-raised` (popovers, modals). Every container has a 1px `--a-edge`
  (the line colour at low alpha) and `--a-shadow-panel`: a very soft drop
  shadow in light, a 1px inner top highlight in dark (where depth comes from
  surface lightness). Floating surfaces are translucent (`--a-raised-glass`)
  over a 20px backdrop blur, with `--a-edge-strong` and the larger, softer
  `--a-shadow-pop`. Inputs are filled with a 1px border all round. Secondary
  buttons, chips, badges, the segmented track and filter buttons are tonal
  fills; ghost buttons are text. Coloured edges remain only where they mean
  something: the danger zone's red hairline, the selected chip's accent edge,
  a notice's faint edge in its own colour, and the focus ring.
- **Icons: the nav, standard actions and meaning carriers.** Every nav item
  (and Back to Home) has a 20px outline lucide icon; group labels never do.
  Text buttons stay text-only except the standard actions that modern apps
  mark with an icon, the same icon everywhere, 20px (18px in a compact
  button), never in a circle or tile: **Add / New** a leading `Plus`
  ("New game", "New plan", "Add moderator"), **Refresh** a leading
  `RefreshCw` ("Refresh", "Sync now"), **Export** a leading `Download`
  ("Export CSV"), and an **external link** a trailing `ArrowUpRight` ("View
  GitHub release"). Nothing else: no icons on Save, Cancel, Check for
  updates, Scan, Browse, Edit, Lock, segments, field labels or headings.
  Meaning carriers also keep theirs: icon-only buttons for row actions
  (delete, copy, reorder, close, clear search) with an `aria-label` (and a
  `title` where the action is not obvious); the leading magnifier of a search
  field; the dropdown chevron of a filter button; the row-expand chevron
  (Accounts) and row-open chevron (All devices); the x of a removable filter
  chip; Notice icons; status dots and the verified check; and the optional
  32px outline icon above an empty or locked state's title. Units in a field
  are words ("min", "sec", "₹"), not icons.
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

- **Choice:** *Dark · Light · System*, a three-way radio group (the kit's
  segmented track, three equal segments, the chosen one raised) at the top of the sidebar footer,
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
  sidebar, panel, panel-2, inset, tonal, raised, panel footer, field, the
  translucent page bar, table header and popover glass composited over what
  they float on, the chosen segment, the active nav tint and the selected-row
  tints); the focus line, the switch "on" track, checkbox borders, nav icons
  and the active nav icon reach 3:1. Tertiary text never sits on a hover fill
  (`--a-nav-hover`, `--a-tonal-hover`): the kit steps it up to `--a-text-2`
  there. Fields are identified by fill plus a 1px border (about 1.5:1) and
  their label; the focus state is the accent border and ring. Re-check with a
  contrast script when a token changes.

## Files

| File | Owns |
| --- | --- |
| `src/renderer/styles/admin/tokens.css` | The Red Hat font imports; the `--a-*` colour, depth and weight tokens for the dark and light themes (with `color-scheme`); the theme-independent tokens (radius by role, type, sizes, focus ring, motion, layout, the page bar); and the bridge that re-points the global console tokens inside the Control Room (below) |
| `src/renderer/styles/admin/shell.css` | Screen grid, sidebar (brand tile, section labels, nav items with icons, theme switch, Back to Home, hints), page container (1240 / 1760px), the sticky page bar (title + header actions), the intro (description, scope note), the tab content's entrance and the main admin chip |
| `src/renderer/styles/admin/kit.css` | Base elements inside `.admin-screen` (focus ring, fields, checks) and every shared primitive: panels, grouped inset rows and footers, buttons (icons, press), fields, switch rows, inline switches, danger zone, segmented, toggle chips, badges, status text, stat row, tables (inset rows, sticky translucent header, clickable, selected and expanded rows), notices, empty and loading, facts lists, list rows, FilterPopover with its pickers and active-filter chips, modals, and the reduced-motion rules |
| `src/renderer/styles/admin/library.css` | Games (library list, editor groups, artwork, sticky save bar), the installed game picker modal (edge-to-edge list), Scan (results table, confidence bars) |
| `src/renderer/styles/admin/settings.css` | Sessions (play access choices, page save bar), Branding, System (the `kiosk` tab: diagnostics columns, exit PIN width), Updates (summary, progress, restart modal) |
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

- **Surfaces are layered, not decorated.** `--a-bg` page, `--a-sidebar`,
  `--a-panel` for every grouped container (tables, stat rows, grouped lists,
  forms, standalone facts lists) with its 1px `--a-edge` and
  `--a-shadow-panel`, `--a-raised-glass` for popovers and modals with
  `--a-edge-strong` and `--a-shadow-pop`, `--a-tonal` for secondary buttons,
  chips, badges, filter buttons and the segmented track. Page CSS that draws
  its own container uses the same three tokens (`--a-edge`,
  `--a-shadow-panel`, `--a-radius-panel`). No gradients, no glows, no
  coloured shadows, no heavy drop shadows.
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
  | `--a-weight-strong` | 600 / 700 | Group titles (h3/h4, `.admin-subheading`: "Details", "Lockdown", "Games played"), the primary button, the chosen segment, the active nav item |
  | `--a-weight-display` | 600 / 700 | Red Hat Display: section and sub-page titles, figures |
  | `--a-weight-title` | 600 / 650 | Red Hat Display large titles: the page title, modal titles, the sidebar "Control Room" (with -0.02em tracking) |

  The step matters most where a group title sits beside labels of the same
  size and colour (the Games editor's "Details" next to "Game title"): strong
  is always one notch above medium, in both themes.
- **Sentence case everywhere.** No uppercase and no letter-spacing, except
  keyboard key names (`.admin-kbd`) and the sidebar's group labels (uppercase,
  +0.08em), which must read as section labels, never as tabs.
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
- **Focus: the soft ring**, for `:focus-visible` and `.controller-focused`,
  in both themes, including the controller-focused nav item: a 1px accent
  line (`outline: var(--a-focus-line)` at offset 0) plus 3px of accent at
  ~35% outside it (`box-shadow: var(--a-focus-halo)`; the soft colour is
  `--a-focus-soft`). A control's own shadow (the primary button's top
  highlight, the chosen segment's lift) rides along through `--btn-shadow`,
  so it is never lost on focus. Fields turn their border accent and add the
  3px ring (`--a-focus-halo-field`). Never a blurred glow. Whole rows inside
  a clipped container (switch rows in a grouped list, radio rows, picker
  options, the game picker rows) draw `--a-focus` (2px solid accent) inside
  the row (`outline-offset: -2px`) on the row's highlight; a switch row in an
  ordinary form outlines at offset 4px. An element with its own focus look
  replaces the kit ring instead of adding a second one (the timeline
  segments outline only the drawn bar, the device detail's back link sits at
  offset 0); see Specificity for how.
- **Pending buttons, one rule for every page.** A text button never shows a
  spinner (a standard-action icon, see Icons, stays as it is). While its
  action runs it is disabled and its label becomes the "-ing" form with
  three dots: "Saving...", "Checking...",
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
- **Motion: quick and quiet, all of it off under `prefers-reduced-motion`.**
  Colour, background, border and shadow transitions 120ms (`--a-dur`); a
  pressed button, segment, chip, filter button or nav item scales to 0.98
  over 90ms (`--a-press-scale`, `--a-dur-press`); each tab's content fades in
  and rises 4px over 160ms (`.admin-page-body`, `--a-dur-enter`); popovers
  and modals fade in from 0.98 over 140ms (`--a-dur-pop`); an expanded table
  row's content fades in over 160ms; the switch knob slides over 160ms. No
  lift, glow, shimmer, bounce or hover transforms. The page bar's hairline is
  scroll-driven (`animation-timeline: scroll()`), not timed.

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
| `--a-panel` | `#1a191f` | `#ffffff` | Every grouped container: panels, tables, stat rows, standalone facts lists |
| `--a-panel-2` | `#232129` | `#f2f0f5` | Row hover and focus highlights, picker hover |
| `--a-panel-footer` | `#17161c` | `#faf9fc` | The panel footer strip |
| `--a-raised` / `--a-raised-glass` | `#222028` / same at 86% | `#ffffff` / white at 88% | Floating surfaces (popovers, modals); the glass one sits over a 20px blur |
| `--a-inset` | `#131217` | `#f8f7fa` | Expanded table row (the well) |
| `--a-tonal` / `--a-tonal-hover` | `#26242d` / `#302d38` | `#e9e6ee` / `#dfdbe5` | Secondary buttons, toggle chips, badges, filter buttons, segmented track, active-filter chips, key caps |
| `--a-nav-hover` | `#1f1d25` | `#e4e1e9` | Nav item hover and focus |
| `--a-bar` | bg at 80% | bg at 80% | The sticky page bar (over a 16px blur) |
| `--a-table-head` | panel at 82% | white at 84% | Sticky table header (over a 16px blur) |
| `--a-edge` / `--a-edge-strong` | white at 6% / 10% | ink at 8% / 12% | 1px container edge / floating-surface edge |
| `--a-shadow-panel` | inner top highlight (white 3.5%) | `0 1px 2px` + `0 1px 1px` ink at 6% / 4% | Container depth |
| `--a-highlight` | white at 16% | white at 18% | Top highlight inside the primary (and confirming danger) button |
| `--a-logo-tile` | `#0e0d12` | `#18161d` | The brand logo's tile (dark in both themes) |
| `--a-field` / `--a-field-hover` | `#111015` / `#15141a` | `#ffffff` / `#fbfafc` | Input, select, textarea fill |
| `--a-field-line` / `--a-field-line-hover` | `#3a3743` / `#4a4654` | `#d5d1db` / `#bdb8c5` | Field border, all round (hover) |
| `--a-field-line-bottom` | `#6a6675` | `#8f8a99` | Kept for pages; the kit no longer draws a heavier bottom |
| `--a-control-border` | `#6a6675` | `#8a8693` | Unchecked checkbox and radio |
| `--a-segment-on` / `--a-segment-shadow` | `#3a3744` / dark lift + inner highlight | `#ffffff` / soft ink shadow | The chosen segment, raised above its track |
| `--a-switch-off` / `-hover` / `--a-switch-knob` / `--a-knob-shadow` | `#3d3a46` / `#4a4654` / `#efedf3` | `#c4bfcc` / `#b3adbc` / `#ffffff` | Switch track off, hover; knob and its shadow; scrollbar thumb |
| `--a-line` / `--a-line-strong` | `#2a2830` / `#3a3742` | `#e3e0e8` / `#cfcbd6` | Hairlines between rows / the filter button's value divider |
| `--a-text` / `-2` / `-3` | `#efedf3` / `#a7a3b0` / `#8e8a98` | `#18161d` / `#5d5966` / `#6a6674` | Primary / secondary / tertiary text |
| `--a-inverse` | `#111015` | `#ffffff` | Text on a solid red (confirm delete) |
| `--a-accent` | `#ff4fa3` | `#c2185b` | NXGS magenta: primary fill, active nav icon, focus line, links, switch on, checked boxes |
| `--a-accent-strong` | `#ff79b9` | `#a3134c` | Primary hover, link hover, text on an accent tint |
| `--a-accent-edge` | `#e23d8d` | `#9c1149` | The primary button's slightly darker 1px edge |
| `--a-on-accent` | `#1a0710` | `#ffffff` | Text and check marks on the accent |
| `--a-accent-tint` / `-tint-faint` / `-line` | magenta at 14% / 8% / 50% | magenta at 12% / 7% / 45% | Active nav fill, selected chip, active filter, selected row on hover / selected table and list row / selected chip edge |
| `--a-focus-soft` | magenta at 35% | magenta at 30% | The soft 3px half of the focus ring |
| `--a-green` `--a-amber` `--a-red` `--a-blue` | see Status colours | | Meaning only |
| `--a-*-tint` | hue at 12% | hue at 10% | Notice, badge and danger button backgrounds |
| `--a-red-tint-strong`, `--a-red-strong` | red 20%, `#ff8a70` | red 16%, `#972c0e` | Danger hover |
| `--a-red-line` | red at 40% | red at 40% | Danger zone hairline |
| `--a-neutral-tint` | text at 5% | text at 4% | Neutral notice |
| `--a-scrim`, `--a-shadow-pop` | | | Modal backdrop; popover and modal shadow (larger and softer, plus an inner highlight in dark) |
| `--a-weight-medium` / `-strong` / `-display` / `-title` | 500 / 600 / 600 / 600 | 600 / 700 / 700 / 650 | Font weights (see Rules: weights come from tokens) |

Theme-independent tokens:

| Token | Value | Use |
| --- | --- | --- |
| `--a-radius-panel` (= `--a-radius`) | 14px | Panels, grouped lists, tables, stat rows, standalone facts lists, popovers, modals |
| `--a-radius-control` (= `--a-radius-sm`) | 10px | Buttons, inputs, selects, segmented track, nav items, notices, row highlights |
| `--a-radius-segment` / `--a-radius-chip` | 8px / 8px | Segments inside a track / toggle chips, filter buttons, active-filter chips, picker rows |
| `--a-radius-badge` (= `--a-radius-xs`) | 6px | Badges, key caps, checkboxes, thumbnails, small inline buttons |
| `--a-radius-inner` | 2px | Thin bars: timeline strip pieces, share bars |
| `--a-row-inset` | 4px | How far a row highlight sits inside its container (14 - 4 = 10px corners) |
| `--a-font-display` | Red Hat Display | Page title, section and modal headings, figures, sidebar brand |
| `--a-font` | Red Hat Text | All UI text |
| `--a-font-mono` | Red Hat Mono, Cascadia Mono, Consolas | IDs, payment IDs, paths, key names |
| `--a-size-*` | see Rules: type | One token per text role, 0.26.0 base size × x-height ratio |
| `--a-focus-color`, `--a-focus-line`, `--a-focus-halo`, `--a-focus-halo-field` | accent, `1px solid`, `0 0 0 4px` soft, `0 0 0 3px` soft | The soft focus ring on controls (outline line + box-shadow halo) and fields (border + halo) |
| `--a-focus`, `--a-focus-offset` | `2px solid` accent, 2px | Whole-row focus inside clipped containers (drawn inside the row) and page-specific outlines |
| `--a-dur`, `--a-dur-press`, `--a-dur-enter`, `--a-dur-pop`, `--a-ease`, `--a-press-scale` | 120 / 90 / 160 / 140ms, 0.98 | Colour transitions, press, tab entrance, popover entrance |
| `--a-control` / `--a-control-sm` / `--a-input` | 48 / 40 / 48px | Buttons and header actions / compact buttons, segments, chips, filter buttons, row actions / inputs, selects and the segmented track |
| `--a-row` / `--a-header-row` | 56 / 44px | Table rows / column header |
| `--a-setting-row` / `--a-list-row` | 66 / 68px | Switch, value and radio rows / list rows with a thumbnail (Games library) |
| `--a-nav-item` / `--a-brand-logo` | clamp(40px, 5.2vh, 54px) / clamp(36px, 4.2vh, 46px) | Sidebar nav items / logo tile |
| `--a-thumb` / `--a-icon` / `--a-icon-sm` / `--a-icon-empty` / `--a-check` | 44 / 20 / 18 / 32 / 20px | Game artwork square / icons in nav items, buttons and hint glyphs / icons in compact buttons, fields, notices / the icon above an empty or locked state / checkboxes and radios |
| `--a-switch-w` / `--a-switch-h` | 46 / 28px | The switch (iOS proportions, 24px knob) |
| `--a-btn-pad-x` / `--a-btn-pad-x-sm` / `--a-field-pad-x` | 20 / 14 / 14px | Horizontal padding in buttons / compact buttons and chips / fields |
| `--a-panel-pad` / `--a-modal-pad` | clamp(22px, 1.6vw, 28px) / 32px | Panel padding (and footer, stat cells) / modal padding |
| `--a-cell-pad-x` / `--a-cell-pad-edge` | 14 / 20px | Table cell padding / first and last cell from the panel edge |
| `--a-sidebar-width` | clamp(248px, 17vw, 320px) | Sidebar (the 0.26.0 width) |
| `--a-page-pad-top` / `--a-page-pad-x` / `--a-page-pad-bottom` | clamp(24px, 3.6vh, 40px) / clamp(32px, 2.8vw, 56px) / 64px | Content padding |
| `--a-page-max` / `--a-page-max-data` / `--a-side-column` / `--a-section-gap` | 1240 / 1760 / clamp(360px, 24vw, 440px) / 40px | Layout |
| `--a-page-bar-pad-y` / `--a-page-bar-height` / `--a-sticky-top` | 14px / max(48px, title line) + 28px / bar height - top padding + 16px | The sticky page bar; a page's own sticky element uses `top: var(--a-sticky-top)` so it stops 16px under the bar |

**Console token bridge.** The last block of `tokens.css` re-points the global
console tokens inside `.admin-screen` only: `--ps-*` surfaces/text/status
(`--ps-blue*` become the accent), `--panel-*`, `--text-primary/secondary`,
`--font-ui` / `--font-display` (Red Hat), `--radius-*` (pill becomes 6px),
`--text-*`, `--focus-*` and `--focus-ring*` (the soft ring: 1px accent + 3px soft),
`--hover-ring`, `--shadow-1/2` (none), `--dur-*` (120ms), the slider and
controller glyph colours. It exists for the shared pieces the Control Room
renders (base inputs and buttons, the modal shell, `ControllerHints`,
`.ps-switch`) and makes them follow the theme. **Never use those names in
admin CSS; use `--a-*`.**

## Shell (AdminScreen)

- Sidebar (`--a-sidebar-width`, 248-320px): the logo on a dark 10px tile +
  "Control Room" (`--a-size-brand`, Red Hat Display, title weight) + device
  name; then the nav groups *Library* (Games, Scan), *This device* (Sessions,
  Plans, Details, Branding, System, Updates), *Business* (Accounts, All
  devices).
  - **Group labels are section labels, never tabs:** `--a-size-caption`
    uppercase with +0.08em tracking, `--a-text-3`, medium weight, aligned with
    the icon column; not focusable, no hover, no pointer (`cursor: default`,
    no `user-select`). Groups after the first sit 20-28px lower (the nav gap,
    `clamp(20px, 2.6vh, 28px)`) with a short hairline centred in that gap; a
    6px gap separates a label from its first item.
  - **Nav items:** a 20px outline lucide icon (`.admin-nav-icon`, stroke 1.75,
    `--a-text-3`) then the label (`--a-size-nav`, `--a-text-2`), 12px apart,
    at `--a-nav-item` height, 10px radius, 2px between items. Hover and
    keyboard/controller focus: `--a-nav-hover` fill, `--a-text` label,
    `--a-text-2` icon (focus adds the soft ring). Active: the `--a-accent-tint`
    fill, `--a-text` at the strong weight and an `--a-accent` icon. No bar.
    A press scales to 0.98. Icons: Games `Gamepad2`, Scan `ScanSearch`,
    Sessions `Timer`, Plans `Ticket`, Details `Monitor`, Branding `Palette`,
    System `Settings`, Updates `CircleArrowDown`, Accounts `Wallet`, All
    devices `Network`.
  - **System** is the label and page title of the `kiosk` tab (lockdown
    behaviour, live diagnostics, local storage and exit); the internal id
    stays `kiosk` (tests, `ADMIN_TABS`, the settings page component).
  - `ADMIN_TABS` follows the sidebar order, so arrow keys and the D-pad move
    through it top to bottom. Footer, top to bottom: the theme switch (Dark ·
    Light · System, see Themes), "Back to Home" (styled as a nav item with a
    `House` icon) and one line of controller hints. On screens up to 800px
    tall (1366×768) the hint line is hidden so the ten items, the theme
    switch and Back to Home fit without the sidebar scrolling.
- **Page bar (sticky):** `header.admin-page-header` holds the `PAGE_COPY[tab]`
  title (`--a-size-title` Red Hat Display at `--a-weight-title`, -0.02em) and,
  on the right, the actions slot then (main admin pages, while unlocked) the
  "Main admin unlocked · Lock" chip after a hairline. It sticks to the top of
  the content pane on a full-width band of `--a-bar` (the page background at
  80%) over `backdrop-filter: blur(16px) saturate(140%)`; the band's hairline
  fades in once content scrolls under it (a scroll-driven animation on
  `scroll(nearest block)`, no script). Its height is `--a-page-bar-height`;
  the pane's `scroll-padding-top` keeps keyboard focus and `revealInContent`
  clear of it, and a page's own sticky element uses `top: var(--a-sticky-top)`.
- **Intro:** `.admin-page-intro` under the bar (it scrolls away): the
  description (`--a-size-lead`) and the scope note (`--a-size-small`),
  always present so every intro has the same height: "Applies to Station
  01", "Earnings from Station 01" (Accounts, this device), "Earnings from
  every device" (Accounts, all devices) or "Covers every device" (All
  devices). 36px then separate it from the first section; no hairline.
- **Content:** `.admin-page-body`, keyed by tab, fades in and rises 4px when
  a tab opens. `DATA_TABS` (games, accounts, fleet) get the 1760px container.
- Kept behaviour: `data-admin-tab` on nav buttons, `.controller-focused` on the
  focused nav item, Escape/B closes (not from inputs or an open
  `[data-admin-popover]`), arrows stay inside `[data-admin-local-keys]` (the
  theme switch is one), the main admin is locked on unmount, `{owner.dialog}`
  (PinDialog) renders in the Control Room, `data-admin-theme` on the root.

Put page-level actions (Refresh, Export, Add) in the page bar with
`<PageActions>`, as 48px buttons (with the standard icon where the icon
policy gives one); section-level actions (Sync now, View earnings) are 40px
buttons in the section header:

```tsx
import { Download, RefreshCw } from 'lucide-react';
import { PageActions } from './AdminKit';

<PageActions>
  <button className="admin-btn" type="button" onClick={refresh}><RefreshCw aria-hidden="true" />Refresh</button>
  <button className="admin-btn admin-btn--primary" type="button" onClick={exportCsv}><Download aria-hidden="true" />Export CSV</button>
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

### Panel — the raised surface, and the grouped inset list

`.admin-panel`: `--a-panel-pad` padding, `--a-panel` fill, 14px radius, a 1px
`--a-edge` and `--a-shadow-panel`. `padding="none"` (`.admin-panel--flush`,
clipped to its radius) for edge to edge lists; `padding="rows"`
(`.admin-panel--rows`, 4px `--a-panel-pad`) makes it a **grouped inset
list** of switch rows, value rows or a facts list: kit rows reach to 4px
inside the panel (`--a-row-inset`) and keep their text at `--a-panel-pad`;
between rows an inset hairline (a `::before`, from text edge to text edge);
a switch row's hover and focus fill (`--a-panel-2`) is a 10px rounded shape
concentric with the panel, and the hairlines next to it hide. Page rows
placed in a rows panel follow the same geometry: the Sessions radio rows
(`.settings-choice`) use the 4px inset, a 10px rounded hover and focus
inside the row, with the hairline starting at the label past the radio; the
update summary keeps its own plain hairlines. Other props:
`as` (`div`, `section`, `form`, `ul`, `ol`), any HTML attribute, `ref`.

```tsx
<Panel as="form" className="admin-form" onSubmit={save}>...</Panel>
<Panel padding="rows"><div className="admin-switch-list">...</div></Panel>
```

### Panel footer — feedback and the save button

`.admin-panel-footer`: full-width strip under a hairline at the bottom of a
panel on the slightly different `--a-panel-footer` tone, its bottom corners
following the panel (works in default, flush and rows panels), notice on the
left, the last button pushed right. The Games editor adds
`.game-editor-footer` to make it sticky.

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

`.admin-btn` + `--primary` (accent fill, `--a-on-accent` text, strong weight,
a 1px `--a-accent-edge` and a faint `--a-highlight` top highlight; hover
`--a-accent-strong`; never white), `--secondary` (the default: tonal
`--a-tonal` fill), `--ghost` (text only, `--a-text-2`; tonal on hover),
`--danger` (red text on a red tint, stronger on hover); 10px radius, 48px
with `--a-size-button` text and 20px side padding, sizes `--sm` (40px,
`--a-size-button-sm`, 14px padding) and `--icon` (square, combine with
`--sm`). Every variant keeps a 1px border (transparent unless the variant
draws one) so they line up. A press scales the button to 0.98. A control's
own shadow lives in `--btn-shadow` so the focus ring adds to it. Add
`.confirming` to a danger button for the second click of a two-step delete
(solid red, labelled with the action: "Delete", "Remove device"; Cancel
beside it). Ghost danger (`--ghost --danger`) stays grey until hover: use it
for row delete icons. Text buttons follow the icon policy (Identity: Icons):
only Add/New (`Plus`), Refresh (`RefreshCw`), Export (`Download`) lead with
an icon and an external link ends with `ArrowUpRight`; the kit sizes any
`svg` in an `.admin-btn` to 20px (18px in a compact one) and tightens the
padding on the icon's side by 4px (3px compact). No spinner in a text button:
while busy it is disabled and reads "Saving..." (see Pending buttons).
Icon-only buttons are for row actions (delete, copy, reorder, close) and need
an `aria-label`; while busy the icon becomes a spinner of the same size.
Header actions and form footers are 48px; section, table and toolbar actions
40px. One primary button per view.

```tsx
<button className="admin-btn admin-btn--primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save device'}</button>
<button className="admin-btn admin-btn--primary" type="button" onClick={startNew}><Plus aria-hidden="true" />New plan</button>
<button className="admin-btn admin-btn--sm" type="button"><RefreshCw aria-hidden="true" />{syncing ? 'Syncing...' : 'Sync now'}</button>
<a className="admin-btn admin-btn--ghost" href={releaseUrl}>View GitHub release<ArrowUpRight aria-hidden="true" /></a>
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
48px with `--a-size-input` text and 14px side padding, 10px radius, filled
(`--a-field`: a well darker than the panel in dark, white in light) with a
1px `--a-field-line` border all round; hover `--a-field-hover` and
`--a-field-line-hover`; on focus the border turns accent and the soft 3px
ring appears (`--a-focus-halo-field`). Checkboxes and radios are 20px (6px
radius); checked ones are accent with an `--a-on-accent` mark. Native
pickers and the select list follow the theme through `color-scheme`.

```tsx
<Field label="Device name" required error={nameError}>
  <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
</Field>
```

Also: `.admin-affix-input` (input with a leading search magnifier, or a unit
word before or after it in an `<em>`: "₹", "min", "sec", or the "Sort" label;
the same filled frame, border and ring; the inner input/select loses its own
frame, the wrapper shows focus; no other icons in fields),
`.input-with-button`, `.form-grid` (two columns, `.full` spans both),
`.admin-form` (24px rhythm).

### SwitchRow — on/off setting

`.admin-switch-row` (66px: `--a-size-row-title` title and `--a-size-small`
description left, the 46×28 switch right). Wrap several in
`.admin-switch-list` inside a `padding="rows"` panel: a grouped inset list
(inset hairlines, the row highlights on hover and focus, see Panel); in an
ordinary form the list keeps plain hairlines and focus outlines the row at
offset 4px. `.admin-value-row` is the same row with a value control (a PIN
input, seconds). The switch itself is `.ps-switch[data-on]`: iOS proportions
(`--a-switch-w` × `--a-switch-h`, a 24px knob 2px inside the track with
`--a-knob-shadow`, sliding over 160ms), `--a-switch-off` track when off, the
accent when on; it is the only rounded-full element.

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
(System) and Remove device (All devices).

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

`.admin-inline-switch`: the bare 46×28 switch with an optional label after it
and an optional spinner (`busy`). The checkbox is hidden; the label shows the
soft focus ring. Used by the Plans "Enabled" column, the device detail's games
"On" column and Accounts' "Verified payments only".

```tsx
<InlineSwitch checked={plan.enabled} disabled={busy} busy={toggling} aria-label={`${plan.name} on customer payment screen`} onChange={() => toggle(plan)} />
<InlineSwitch checked={view.verifiedOnly} label="Verified payments only" onChange={setVerifiedOnly} />
```

### Segmented — one choice out of a few

`.admin-segmented`: a tonal track with a 10px radius as tall as an input
(48px), 40px segments with an 8px radius; the chosen segment is **raised**
above the track (`--a-segment-on` fill with `--a-segment-shadow`, `--a-text`
at the strong weight), not tinted: the accent stays for primary actions, the
active nav item, selected chips and focus. Unchosen segments are
`--a-text-2` at the medium weight, `--a-text` on hover; a press scales to
0.98. Buttons carry `aria-pressed` (or `role="radio"` + `aria-checked`, like
the theme switch). Segments are text only: `SegmentedOption` has no icon.

```tsx
<Segmented aria-label="Period" value={period} onChange={setPeriod} options={[
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' }
]} />
```

### ToggleChip — on/off filter

`.admin-chip-toggle[aria-pressed]` (40px, `--a-size-button-sm`, 8px radius, tonal fill; selected:
accent tint, `--a-accent-line` edge, `--a-accent-strong` text and a leading
check drawn by CSS, the same mark the picker's "Whole store" toggle uses, so
no toggle carries an icon element). Group in `.admin-chip-toggles`.

```tsx
<div className="admin-chip-toggles" role="group" aria-label="Device status">
  <ToggleChip pressed={states.includes('active')} onChange={() => toggle('active')}>Active</ToggleChip>
</div>
```

### Badge — a fact about a row

`.admin-badge` (26px, 6px radius, `--a-size-badge` medium, tonal fill, no outline,
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

`.admin-stat-row` is one panel (the panel surface, edge, depth and radius) split into equal cells by
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

`.admin-table-scroll` is the rounded container (the panel surface, edge,
depth and 14px radius) and the scroller, with the rows 4px inside it
(`--a-row-inset`); `.admin-table` inside: a sticky 44px header
(`--a-size-caption` medium `--a-text-2`) on `--a-table-head` over a 16px
backdrop blur, 56px rows of `--a-size-small` text (a row's name
`--a-size-row-title`), 14px cell padding, text 20px from the container edge
on both sides, `.admin-num` for right aligned numbers. Row separators are
inset hairlines (a `td::after`, so `td` is `position: relative`) from the
first cell's text to the last cell's. A hovered row is a 10px rounded
`--a-panel-2` highlight (the first and last cells carry the corners) and the
hairlines next to it hide. No zebra.

- `tr.is-clickable`: the row opens, expands or picks something on click
  (pointer cursor). The row also holds a real button for keyboard and
  controller (device name, expand toggle, Edit).
- `tr.is-selected`: the row being edited or picked: the faint accent tint
  (`--a-accent-tint-faint`, `--a-accent-tint` on hover) as a rounded
  highlight. No bar.
- `tr.admin-table-detail`: the expanded row, an `--a-inset` well joined to
  the row above it (that row keeps its top corners, the well its bottom
  ones), 20px from the container edge, its content fading in. A page that
  needs other padding sets it with a selector of the same weight
  (`.accounts-table tbody tr.accounts-detail-row td`); there is no `:hover`
  rule to match, so the row never shifts under the pointer.

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

`.admin-notice--success|error|warning|info`: a 10px rounded box on the
semantic tint with a faint 1px edge of the same colour (22%), `--a-size-small`
text, the 18px icon inline in that colour (the icon carries meaning).
`role="alert"` for errors.

```tsx
<Notice tone="error">{error}</Notice>
```

### EmptyState — nothing to show

`.admin-empty`: left aligned `--a-size-lg` medium title, `--a-size-small` text, optional
`action`, and an optional `icon`: one 32px outline lucide icon above the title
in `--a-text-3` (stroke 1.5), never in a circle or tile. In a padded panel it
uses the panel's padding; in a table scroller or flush panel it keeps the
rows' 20px inset. Locked states (the main admin gate) follow the same shape.

```tsx
<Panel>
  <EmptyState title="No plans saved" icon={<Ticket />}>Add a plan to make play-time checkout available to customers.</EmptyState>
</Panel>
```

### LoadingState — waiting

`.admin-loading`: 18px spinner + `--a-size-lead` text, inline, left aligned.

### Facts list — label/value pairs

`<dl class="admin-meta-list"><div><dt/><dd/></div></dl>`: hairline rows on the
text baseline (`--a-size-small`, 13px row padding). Default: label left (as
wide as it needs), value right, for short facts in a side column (Device page
identity, device detail). `.admin-meta-list--left`: a 210px label column
(`--a-meta-label`) and left aligned values, for facts in a main-column panel
or values that can be long (cloud sync, local storage paths, update facts,
diagnostics). **A facts list on its own** (not inside a panel, table, modal or
popover) is its own grouped container: the panel surface, 14px radius, edge,
depth and `--a-panel-pad` inset, so its hairlines are inset. Inside a
`padding="rows"` panel it is just the rows.

### List rows — `.admin-list > .admin-list-row`

A grouped list inside a flush panel (the Games library): 68px rows (a 44px
thumbnail, `--a-size-row-title` name and `--a-size-small` second line) 4px
inside the panel, inset hairlines between them; hover and keyboard focus are
a 10px rounded `--a-panel-2` highlight and `.selected` the faint accent tint
(no bar), with the neighbouring hairlines hidden. `.row-main` is the
clickable part. Use a table for data.

### FilterPopover, pickers, active filters

`FilterPopover` (`FilterPopover.tsx`) is a filter button (`.admin-popover-trigger`,
a tonal chip with a chevron that reads "Devices | 3 devices" once active, then
styled like a selected chip; its chevron turns over while open) and a panel
under it (`.admin-popover-panel`: the floating surface, `--a-raised-glass`
over a 20px blur, 1px `--a-edge-strong`, 14px radius, `--a-shadow-pop`,
fading in from 0.98 over 140ms). The panel carries `data-admin-popover` while open
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
`.admin-screen` they are themed (`--a-scrim` backdrop fading in; the modal is
the floating surface: `--a-raised-glass` over a 20px blur, 1px
`--a-edge-strong`, 14px radius, `--a-shadow-pop`, fading in from 0.98 over
140ms; 32px padding, `--a-size-modal-title` Red Hat Display heading at the
title weight, `--a-size-body` copy). Render them inside the page component so they stay
inside `.admin-screen`. A close button is
`admin-btn admin-btn--icon admin-btn--ghost close-button`: the kit pins it to
the top right corner of every modal. The PinDialog is portaled outside and
keeps its own console look (dark) in both themes.

**A list inside a modal runs edge to edge** (the installed game picker,
`.installed-game-list` in `library.css`): no frame of its own, it spans the
modal's full width between two hairlines (`margin-inline` minus `--a-modal-pad`), rows are
separated by hairlines, a sticky column header sits on the modal's own surface,
and every column lines up with the modal's 32px content edge. Keyboard and
controller focus draw the outline inside the row (`outline-offset: -2px`)
so the scroller never clips it. Do not put a framed table or a panel inside
a modal.

### Type and layout helpers

| Class | Purpose |
| --- | --- |
| `.admin-subheading` | `--a-size-label` Red Hat Text at the strong weight: a group title inside a section or panel ("Details", "Lockdown", "Games played"), one notch above the labels beside it |
| `.admin-text-2`, `.admin-caption` | Secondary colour; `--a-size-caption` caption |
| `.admin-count` | `--a-size-small` `--a-text-2` count or short meta next to a heading or toolbar ("8 saved", "4 of 5 on", "Last scan 2:05 pm") |
| `.admin-num` | Tabular, right aligned, no wrap |
| `.admin-mono` | `--a-size-mono` Red Hat Mono, selectable (IDs, payment IDs, paths) |
| `.admin-kbd` | Keyboard key name in Red Hat Mono on a tonal key cap (6px radius): filled `--a-tonal`, no edge line, in both themes (uppercase, like the nav group labels) |
| `.admin-visually-hidden` | Screen-reader-only text |
| `.admin-stack` | Vertical 40px rhythm between sections |
| `.admin-split` | Main + side column (`--a-side-column`), stacked below 1100px |

### Other exports

- `ArtImage`: image with a fallback node.
- `revealInContent(element)`: scrolls an editor into view inside `.admin-content` when its top is off screen or under the sticky page bar.
- Types: `NoticeTone`, `Tone`, `SegmentedOption`, `PanelProps`.

## Copy

- **Sentence case** for every title, label, button and status ("Save
  settings", "Last resume result"). Proper names keep their capitals (Home,
  Control Room, NXGS Play, Razorpay, Microsoft Store), as do key names.
- **"Device", never "station"**, in staff-facing copy: "this device", "Device
  details", "device admin PIN", "This device" (nav group, badge, scope). Station
  01 is just the default device name. Code identifiers (`stationId`) stay.
- **Name sections as the nav does:** Games, Scan, Sessions, Plans, Details,
  Branding, System, Updates, Accounts, All devices ("managed from Plans",
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
- No icons in text buttons beyond the standard set (Add/New `Plus`, Refresh
  `RefreshCw`, Export `Download`, external link `ArrowUpRight`), and none in
  segments, field labels, headings or nav group labels; no spinner in a text
  button (its label changes instead). Every nav item has its icon.
  Icon-only row actions keep their icon and an `aria-label`.
- No eyebrows (small uppercase label over a title). The sidebar's group
  labels are the one uppercase label, and they head a list, not a card.
- No icons in tinted circles or rounded squares: not in nav, headers, stat
  tiles, empty states or list rows.
- No pills for statuses, counts or tags; no `border-radius: 999px` except the
  switch; no radius that is not one of the role tokens (14 / 10 / 8 / 6 / 2px).
- No heavy borders around containers: a container's edge is the subtle 1px
  `--a-edge`; coloured edges are for the danger zone, a selected chip, a
  notice and focus. No edge-to-edge separators inside a grouped container
  (inset them); no 2px accent bars marking a selected nav item or row (the
  rounded tint does it).
- No glows or blurred halos; focus is the soft ring (1px line + 3px soft).
- No gradients, blue-tinted surfaces or heavy drop shadows; depth is the
  layered surfaces, `--a-shadow-panel` and, for floating surfaces only,
  `--a-shadow-pop`.
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
- No lift, shimmer, bounce or hover transforms; the only motion is the set in
  Rules: motion (press 0.98, the 160ms tab entrance, the 140ms popover and
  modal entrance, colour transitions), and all of it stops under
  `prefers-reduced-motion`.
- No colour outside the status mapping; no second status style for the same
  state on another page.
- No `--ps-*`, `--radius-*`, `--focus-ring` or other console tokens in admin
  CSS; no page CSS that restyles a primitive or reuses another page's classes.
- No `.admin-screen .x` prefix in page CSS just to out-rank a kit heading,
  focus or expanded-row rule; those are kept low (see Specificity) so one
  class wins.
- No page sticky element at `top: 0`: the page bar is sticky there; use
  `top: var(--a-sticky-top)`.
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
   focus visible on every control, nothing hidden under the sticky page bar,
   Escape/B still closes the Control Room.

Checks: `npx tsc --noEmit`, `npm run test:accounts`, `test:fleet-ui`,
`test:fleet-backend`, `test:device-manager`, `test:plan-manager`,
`test:free-play`, `test:console-language`, `test:back-navigation`,
`test:controller-navigation`, `test:controller-bridge`, `test:controller-idle`,
`test:home-hero`, `test:launch-flow`, `test:close-flow`,
`test:secret-admin-shortcuts`, `test:home-overlay`.
