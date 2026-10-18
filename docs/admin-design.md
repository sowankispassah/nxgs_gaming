# Control Room design system

The Control Room (`src/renderer/components/admin/AdminScreen.tsx` and every page
it renders) is a quiet operator console: dark, neutral, dense and typographic.
Hierarchy comes from type, alignment and hairlines, not from boxes. Colour only
carries meaning (status, verified money, errors). Hit targets are 32px high
(only the compact controls the kit defines, small buttons, segments, toggle
chips and the inline switch, are 28px) and focus is always a visible outline,
because staff may drive it with a controller.

Customer surfaces (Home, Settings, the quick menu, PinDialog,
AdminOptionsDialog...) are out of scope. Nothing here touches `:root` tokens.

## Files

| File | Owns |
| --- | --- |
| `src/renderer/styles/admin/tokens.css` | `--a-*` tokens on `.admin-screen`, plus the bridge that re-points the global console tokens inside the Control Room (below) |
| `src/renderer/styles/admin/shell.css` | Screen grid, sidebar and nav, page container (1120 / 1600px), page header, scope note, header actions and the main admin chip |
| `src/renderer/styles/admin/kit.css` | Base elements inside `.admin-screen` and every shared primitive: panels and footers, buttons, fields, switch rows, inline switches, danger zone, segmented, toggle chips, badges, status text, stat row, tables (clickable and selected rows), notices, empty and loading, facts lists, list rows, FilterPopover with its pickers and active-filter chips, modals |
| `src/renderer/styles/admin/library.css` | Games (library list, editor groups, artwork, sticky save bar), the installed game picker modal, Scan (results table, confidence bars) |
| `src/renderer/styles/admin/settings.css` | Sessions (play access choices, page save bar), Branding, Kiosk (diagnostics columns, exit PIN width), Updates (summary, progress, restart modal) |
| `src/renderer/styles/admin/plans.css` | Plans: table column widths and the editor's customer preview |
| `src/renderer/styles/admin/device.css` | Device: the device ID cell with its copy button |
| `src/renderer/styles/admin/accounts.css` | Accounts: filter bar layout, result line, sessions table columns and expanded row, By device / Top games share bars |
| `src/renderer/styles/admin/fleet.css` | All devices: devices table, device detail (header, games table), moderators table and editor, main admin PIN and sync grid; the one cloud sync rule (`.fleet-sync-error`) that `FleetSyncCard` also uses on the Device page |
| `src/renderer/components/admin/AdminKit.tsx` | React primitives |
| `src/renderer/components/admin/FilterPopover.tsx` | The filter button + panel (keyboard and controller handling) |

`src/renderer/styles.css` imports them in that order. Page files are
independent of each other: no page file uses another page's classes. Page CSS
only lays primitives out (column widths, one-off cells) and never restyles
them; anything a second page needs goes into the kit.

## Rules

- **Surfaces are flat.** `--a-bg` page, `--a-sidebar`, `--a-panel` for anything
  bordered. No gradients, no glows, no card shadows. Only popovers and modals
  get a shadow (`--a-shadow-pop`).
- **A panel holds a table, a grouped form or a list. Never nest panels.** The
  heading goes above the panel (`PageSection`), never inside it. A form panel
  ends in a full-width `.admin-panel-footer` (feedback left, button right).
- **Sections:** h2 (15/600) + optional one-line 13px description, 12px gap,
  content. 32px between sections (`.admin-stack` or consecutive `PageSection`s).
  A list and its editor are two sections ("Saved plans" / "Edit plan",
  "Moderators" / "Add moderator", "Customer games" / "Add game").
- **Two-column pages:** main column + 340px side column (`.admin-split`), which
  stacks below 1100px. Side columns hold short facts, never forms.
- **Widths:** content is left aligned. Form pages max 1120px; data pages
  (Games, Accounts, All devices, including the device detail) 1600px. Both
  1920×1080 and 1366×768 fit without horizontal page scroll; wide tables scroll
  inside `.admin-table-scroll`.
- **Type does the hierarchy.** One 22px title per page (the shell renders it).
  Body 14px, secondary 13px `--a-text-2`, captions/labels 12px/500
  `--a-text-2`, big figures 24px/600, IDs and paths 12.5px mono. A sub-page
  title (the device detail's name) is 18px; modal titles are 18px.
- **Sentence case everywhere.** No uppercase and no letter-spacing, except
  keyboard key names (`.admin-kbd`).
- **Numbers are tabular** (set on `.admin-screen`). Money and counts in tables
  are right aligned (`.admin-num`). Dates and times come from `fleetFormat`
  (`dateLabel` "14 Oct 2026", `timeLabel` "2:05 pm", `dateTimeLabel`,
  `relativeTime`), never from `toLocale*String` with the system locale.
- **States are words:** a status is `StatusText` (dot + label, colours below),
  a fact is a `Badge`, a count is plain `.admin-count` text ("8 saved",
  "4 of 5 on"). Never pills.
- **Facts lists have one alignment rule:** values right aligned only for short
  facts in a side column; anywhere wider, or when a value can be long (paths,
  IDs, errors, notes), the label column is fixed and values are left aligned
  (`.admin-meta-list--left`).
- **Focus:** `outline: 2px solid #ededee; outline-offset: 2px` on everything
  focusable, for `:focus-visible` and `.controller-focused`. No glow, no
  box-shadow ring. Hidden-checkbox controls (switch rows, inline switches,
  radio rows, picker options) outline the whole row or label.
- **Motion:** colour/background transitions up to 120ms. No scale, lift, glow,
  shimmer or entrance animation.

## Status colours

One mapping for every page. Pick the tone by what the state means, not by the
page it is on.

| Tone | Colour | Means | Used for |
| --- | --- | --- | --- |
| `success` | green `--a-green` | Done, healthy, on, verified | Completed session, Active device / moderator, Available game, Verified payment (check icon), Synced, Ready (scan), In library, Registered / Supported / Yes (diagnostics), update installed or latest |
| `info` | blue `--a-blue` | Live, in progress, new | Playing session, Syncing..., Live diagnostics, a game running or launching (diagnostics), update available |
| `warning` | amber `--a-amber` | Waiting or needs a look | Pending, Waiting for device, Waiting to sync, Unfinished session, Not verified, Needs confirmation, Rejoin needed, Not registered, a lockdown flag off while customers use the device |
| `danger` | red `--a-red` | Failed, missing, removed | Failed / Sync failed, Missing game, Removed device, Removed by main admin, errors |
| `neutral` | grey dot, `--a-text-2` label | Off, over, or not known | Inactive, Disabled, Time up, Interrupted, Not checked, Not set up, Idle, Local only, Unsupported |

`Badge` tones follow the same table; a plain badge ("This device", "Global",
"Custom") is a fact, not a state. `Stat` values are coloured only when that
carries meaning.

## Tokens (`.admin-screen` only)

| Token | Value | Use |
| --- | --- | --- |
| `--a-bg` | `#0e0e0f` | Page background |
| `--a-sidebar` | `#121213` | Sidebar |
| `--a-panel` | `#161617` | Tables, grouped forms, popovers |
| `--a-panel-2` | `#1d1d1f` | Hover, input hover, selected rows, active nav |
| `--a-inset` | `#111112` | Input fields, expanded table rows |
| `--a-segment` | `#2a2a2d` | Active segment |
| `--a-switch-off` | `#3a3a3d` | Switch off track, scrollbar thumb |
| `--a-line` / `--a-line-strong` | `#262628` / `#36363a` | Hairlines / control borders |
| `--a-text` / `--a-text-2` / `--a-text-3` | `#ededee` / `#a1a1a6` / `#6e6e73` | Primary / secondary / tertiary text |
| `--a-inverse` | `#0e0e0f` | Text on the light primary button |
| `--a-green` `--a-amber` `--a-red` `--a-blue` | `#3ecf8e` `#f5a524` `#f2555a` `#7aa7ff` | Meaning only (table above) |
| `--a-*-tint` | same hue at 12% | Notice and badge backgrounds |
| `--a-red-line` | red at 40% | Danger button and danger zone border |
| `--a-white-tint` | white at 8% | Selected toggle chip and active filter button |
| `--a-radius` / `-sm` / `-xs` | 6 / 5 / 4px | Panels, popovers, modals / inputs and buttons / badges and chips |
| `--a-font-mono` | Cascadia Mono, Consolas | IDs, payment IDs, paths |
| `--a-size-title` `-h2` `-body` `-small` `-caption` `-figure` `-mono` | 22 15 14 13 12 24 12.5px | Type scale |
| `--a-focus`, `--a-focus-offset` | `2px solid #ededee`, 2px | Focus outline |
| `--a-shadow-pop` | `0 12px 32px rgba(0,0,0,.45)` | Popovers and modals only |
| `--a-dur`, `--a-ease` | 120ms | Colour transitions |
| `--a-control` / `--a-control-sm` / `--a-input` / `--a-row` / `--a-header-row` | 32 / 28 / 34 / 40 / 36px | Heights |
| `--a-page-max` / `--a-page-max-data` / `--a-side-column` / `--a-section-gap` | 1120 / 1600 / 340 / 32px | Layout |

**Console token bridge.** The second block of `tokens.css` re-points the global
console tokens inside `.admin-screen` only: `--ps-*` surfaces/text/status,
`--radius-*` (pill becomes 4px), `--text-*`, `--focus-ring*` (2px, no glow),
`--shadow-1/2` (none), `--dur-*` (120ms). It exists for the shared pieces the
Control Room renders (base inputs and buttons, the modal shell,
`ControllerHints`, `.ps-switch`). **Never use those names in admin CSS; use
`--a-*`.**

## Shell (AdminScreen)

- Sidebar (224px): logo + "Control Room" + device name; nav groups *Library*
  (Games, Scan), *This device* (Sessions, Plans, Device, Branding, Kiosk,
  Updates), *Business* (Accounts, All devices). `ADMIN_TABS` follows that order,
  so arrow keys and the D-pad move through it top to bottom. Footer: "Back to
  Home" and one line of controller hints.
- Page header: `PAGE_COPY[tab]` title and description, then the scope note,
  always present so every header has the same height: "Applies to Station 01",
  "Earnings from Station 01" (Accounts, this device), "Earnings from every
  device" (Accounts, all devices) or "Covers every device" (All devices). The
  actions slot sits on the right, then (main admin pages, while unlocked) the
  "Main admin unlocked · Lock" chip after a hairline. A hairline closes the
  header.
- `DATA_TABS` (games, accounts, fleet) get the 1600px container.
- Kept behaviour: `data-admin-tab` on nav buttons, `.controller-focused` on the
  focused nav item, Escape/B closes (not from inputs or an open
  `[data-admin-popover]`), arrows stay inside `[data-admin-local-keys]`, the
  main admin is locked on unmount, `{owner.dialog}` (PinDialog) renders in the
  Control Room.

Put page-level actions (Refresh, Export, Add) in the header with
`<PageActions>`; section-level actions (Sync now, View earnings) are 28px
buttons in the section header:

```tsx
import { PageActions } from './AdminKit';

<PageActions>
  <button className="admin-btn" type="button" onClick={refresh}><RefreshCw size={15} />Refresh</button>
  <button className="admin-btn admin-btn--primary" type="button" onClick={exportCsv}><Download size={15} />Export CSV</button>
</PageActions>
```

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

### Panel — the one bordered surface

`.admin-panel` (20px padding). `padding="none"` (`.admin-panel--flush`) for
edge to edge lists; `padding="rows"` (`.admin-panel--rows`, 4px 20px) for a
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

`.admin-toolbar` (8px gap, wraps), `--end`, `--between`; `.admin-toolbar-spacer`.

```tsx
<Toolbar aria-label="Device filters">
  <span className="admin-affix-input"><Search size={15} aria-hidden="true" /><input placeholder="Name, store, location or device ID" /></span>
  <ToolbarSpacer />
  <span className="admin-count">6 devices · 5 active</span>
</Toolbar>
```

### Buttons — classes only

`.admin-btn` + `--primary` (light fill, dark text), `--secondary` (default:
1px border), `--ghost` (no border, `--a-text-2`), `--danger` (red text and
border, red tint on hover); sizes `--sm` (28px) and `--icon` (square, combine
with `--sm`). Add `.confirming` to a danger button for the second click of a
two-step delete. Ghost danger (`--ghost --danger`) stays grey until hover: use
it for row delete icons. Icons 15px (14px small, 16px icon-only), only where
they add meaning (Refresh, Export, Add, Remove). Header actions are 32px;
section, table and toolbar actions 28px.

```tsx
<button className="admin-btn admin-btn--primary" type="submit">Save device</button>
<button className="admin-btn admin-btn--sm" type="button"><RefreshCw size={14} />Sync now</button>
<button className="admin-btn admin-btn--icon admin-btn--sm admin-btn--ghost admin-btn--danger" type="button" aria-label={`Delete ${game.title}`}><Trash2 size={16} /></button>
```

### Field and inputs

`Field` renders `.admin-field` with `.admin-field-label` (13/500),
`.admin-field-required`, `.admin-field-help` / `.admin-field-error` (12px).
With `htmlFor` the label points at the control; without it the label wraps the
control. `error` replaces the help text and turns the control border red.
`.admin-field-help` is also the class for a short standalone note in a form or
side column ("Use 6 or more digits...").

Inputs, selects and textareas are styled by element inside `.admin-screen`
(34px, `--a-inset`, 1px `--a-line-strong`, hover `--a-panel-2`, focus: light
border + outline). Checkboxes/radios are 16px.

```tsx
<Field label="Device name" required error={nameError}>
  <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
</Field>
```

Also: `.admin-affix-input` (input with a leading icon or trailing unit; the
inner input/select loses its own frame, the wrapper shows focus),
`.input-with-button`, `.form-grid` (two columns, `.full` spans both),
`.admin-form` (20px rhythm).

### SwitchRow — on/off setting

`.admin-switch-row` (copy left, 30×18 switch right). Wrap several in
`.admin-switch-list` for hairlines between rows, inside a `padding="rows"`
panel. `.admin-value-row` is the same row with a value control (a PIN input,
seconds). The switch itself is `.ps-switch[data-on]` and is the only
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
`.admin-danger-zone` (red 40% hairline, no fill); each action is a value row:
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

`.admin-inline-switch`: the bare 30×18 switch with an optional label after it
and an optional spinner (`busy`). The checkbox is hidden; the label shows the
focus outline. Used by the Plans "Enabled" column, the device detail's games
"On" column and Accounts' "Verified payments only".

```tsx
<InlineSwitch checked={plan.enabled} disabled={busy} busy={toggling} aria-label={`${plan.name} on customer payment screen`} onChange={() => toggle(plan)} />
<InlineSwitch checked={view.verifiedOnly} label="Verified payments only" onChange={setVerifiedOnly} />
```

### Segmented — one choice out of a few

`.admin-segmented` (1px bordered group, 28px segments, active `#2a2a2d`);
buttons carry `aria-pressed`.

```tsx
<Segmented aria-label="Period" value={period} onChange={setPeriod} options={[
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' }
]} />
```

### ToggleChip — on/off filter

`.admin-chip-toggle[aria-pressed]` (28px, radius 4; selected: light border,
8% white fill, leading check drawn by CSS). Group in `.admin-chip-toggles`.

```tsx
<div className="admin-chip-toggles" role="group" aria-label="Device status">
  <ToggleChip pressed={states.includes('active')} onChange={() => toggle('active')}>Active</ToggleChip>
</div>
```

### Badge — a fact about a row

`.admin-badge` (20px, radius 4, 11.5px/500, 1px border, `--a-text-2`) and
`--success`, `--warning`, `--danger`, `--info` (tint background). For "This
device", "Global", "Custom", "Device admin only". Not for counts or live states.

### StatusText — a state in words

`.admin-status` + `--neutral|success|warning|danger|info`: 6px dot + 13px
label in the semantic colour (mapping above). The label is the only
baseline-aligned item, so a status sits exactly on the text baseline of a table
cell or facts row; no page needs a `vertical-align` or row-centring fix.
`icon` replaces the dot where a mark says more (the verified check).

```tsx
<StatusText tone={session.status === 'completed' ? 'success' : 'neutral'}>{statusLabel}</StatusText>
<StatusText tone="success" icon={<Check size={14} aria-hidden="true" />}>Verified</StatusText>
```

### StatRow + Stat — key figures

`.admin-stat-row` is one panel split into equal cells by hairlines (wraps
cleanly; `minCellWidth` sets the wrap point, default 160px). Each `.admin-stat`:
`.admin-stat-label` (12px), `.admin-stat-value` (24px/600, ellipsis),
optional `.admin-stat-sub` (12px). The same figure has the same label on every
page ("Games on device", "Paid sessions", "Revenue"). No icons.

```tsx
<StatRow aria-label="Device figures" minCellWidth={150}>
  <Stat label="Paid sessions" value={sessions} />
  <Stat label="Revenue" value={formatPaise(revenue)} />
</StatRow>
```

### Table — classes only

`.admin-table-scroll` is the bordered panel and the scroller; `.admin-table`
inside: sticky 36px header (12px/500 `--a-text-2`), 40px rows, hairlines,
16px from the panel edge on both sides, hover `--a-panel-2`, `.admin-num` for
right aligned numbers.

- `tr.is-clickable`: the row opens, expands or picks something on click
  (pointer cursor). The row also holds a real button for keyboard and
  controller (device name, expand toggle, Edit).
- `tr.is-selected`: the row being edited or picked: `--a-panel-2` fill and a
  2px bar on the left edge, like the nav and the Games list.
- `tr.admin-table-detail`: the expanded row (`--a-inset`, 16px padding).

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
colour on its tint, 13px, 15px icon inline. `role="alert"` for errors.

```tsx
<Notice tone="error">{error}</Notice>
```

### EmptyState — nothing to show

`.admin-empty`: left aligned 14px/500 title, 13px text, optional `action`. No
icons. In a padded panel it uses the panel's padding; in a table scroller or
flush panel it keeps the rows' 16px inset.

```tsx
<Panel>
  <EmptyState title="No plans saved">Add a plan to make play-time checkout available to customers.</EmptyState>
</Panel>
```

### LoadingState — waiting

`.admin-loading`: 14px spinner + 13px text, inline, left aligned.

### Facts list — label/value pairs

`<dl class="admin-meta-list"><div><dt/><dd/></div></dl>`: hairline rows on the
text baseline (13px). Default: label left, value right, for short facts in a
side column (Device page identity, device detail). `.admin-meta-list--left`: a
168px label column (`--a-meta-label`) and left aligned values, for facts in a
main-column panel or values that can be long (cloud sync, local storage
paths, update facts, diagnostics). Put it in a `padding="rows"` panel when it
has a frame.

### List rows — `.admin-list > .admin-list-row`

Hairline rows inside a flush panel (the Games library); `.row-main` is the
clickable part; `.selected` adds the `--a-panel-2` fill and the 2px bar. Use a
table for data.

### FilterPopover, pickers, active filters

`FilterPopover` (`FilterPopover.tsx`) is a filter button (`.admin-popover-trigger`,
a toggle chip with a chevron that reads "Devices | 3 devices" once active) and
a panel under it (`.admin-popover-panel`: `--a-panel`, 1px `--a-line-strong`,
radius 6, the pop shadow). The panel carries `data-admin-popover` while open
so Escape/B close it, not the Control Room. Inside, a picker:
`.admin-picker-head` (search + status line with Select all / Clear),
`.admin-picker-list` > `.admin-picker-group` (`.admin-picker-group-header`
with a "Whole store" ghost button) > `.admin-picker-option` rows (32px,
checkbox, `.admin-picker-name`, `.admin-picker-meta`, optional badge; keyboard
focus outlines the row). Active filters show as `.admin-active-chip` buttons
("Device Station 01 ×") in the result line under a filter bar.

### Modal

Control Room modals reuse `.modal-backdrop > .modal` from dialogs.css; inside
`.admin-screen` they are flattened (panel fill, radius 6, pop shadow, 24px
padding, 18px heading). A close button is
`admin-btn admin-btn--icon admin-btn--ghost close-button`: the kit pins it to
the top right corner of every modal. The PinDialog is portaled outside and
keeps its own look.

### Type and layout helpers

| Class | Purpose |
| --- | --- |
| `.admin-subheading` | 13/600 heading inside a section or panel ("Details", "Games played") |
| `.admin-text-2`, `.admin-caption` | Secondary colour; 12px caption |
| `.admin-count` | 13px `--a-text-2` count or short meta next to a heading or toolbar ("8 saved", "4 of 5 on", "Last scan 2:05 pm") |
| `.admin-num` | Tabular, right aligned, no wrap |
| `.admin-mono` | 12.5px mono, selectable (IDs, payment IDs, paths) |
| `.admin-kbd` | Keyboard key name (the one uppercase) |
| `.admin-visually-hidden` | Screen-reader-only text |
| `.admin-stack` | Vertical 32px rhythm between sections |
| `.admin-split` | Main + 340px side column, stacked below 1100px |

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
- Status words in the tables above; ellipses for pending buttons ("Saving...").

## Don'ts

- No eyebrows (small uppercase label over a title).
- No icons in tinted circles or rounded squares: not in nav, headers, stat
  tiles, empty states or list rows. A 15-16px bare icon where it adds meaning.
- No pills for statuses, counts or tags; no `border-radius: 999px` except the
  switch; no radius above 6px.
- No glows, halos or coloured box-shadow rings; focus is the outline.
- No gradients, blue-tinted surfaces or card shadows.
- No uppercase or letter-spacing (key names excepted); no 30px+ headings inside
  a page.
- No nested panels, no card-in-card "sections", no heading inside a panel.
- No huge numbers with an icon badge as KPI tiles; use `StatRow`.
- No decorative icons (trophies...).
- No scale/lift/shimmer/entrance animations, no `transform` hover effects.
- No colour outside the status mapping; no second status style for the same
  state on another page.
- No `--ps-*`, `--radius-*`, `--focus-ring` or other console tokens in admin
  CSS; no page CSS that restyles a primitive or reuses another page's classes.

## Adding to a page

1. Build it from `PageSection` + `Panel` (+ `.admin-panel-footer` for a form),
   tables with `.admin-table-scroll`, facts with `.admin-meta-list`.
2. States are `StatusText` with the mapped tone, facts `Badge`, counts
   `.admin-count`.
3. Labelled controls use `Field`; buttons use `.admin-btn` classes; page-wide
   actions go into `<PageActions>`.
4. Put only layout in the page's CSS file, with `--a-*` tokens. If you need a
   look the kit does not have and a second page will need it, add it to the
   kit and this catalogue.
5. Keep behaviour, keyboard/controller support and copy meaning. Tests in
   `scripts/verify-*.mjs` read component source and assert some strings (for
   example "Main admin unlocked", "Only games linked to", "Saved results will
   belong to", "Play durations and prices are managed from Plans.", "Allow free
   play", `'Save settings'`, `<th scope="col">Customer</th>`). If you change an
   asserted string, update the assertion and keep what it protects.
6. Check 1920×1080 and 1366×768: no horizontal page scroll, focus visible on
   every control, Escape/B still closes the Control Room.

Checks: `npx tsc --noEmit`, `npm run test:accounts`, `test:fleet-ui`,
`test:fleet-backend`, `test:device-manager`, `test:plan-manager`,
`test:free-play`, `test:console-language`, `test:back-navigation`,
`test:controller-navigation`, `test:controller-bridge`, `test:controller-idle`,
`test:home-hero`, `test:launch-flow`, `test:close-flow`,
`test:secret-admin-shortcuts`, `test:home-overlay`.
