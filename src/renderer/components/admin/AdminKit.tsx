/**
 * Control Room kit: the React primitives every admin page builds on.
 *
 * Styles live in styles/admin/kit.css; rules, the full catalogue and usage
 * examples are in docs/admin-design.md. Keep pages on these primitives instead
 * of styling one-off cards, chips and headings.
 */
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref
} from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { toFileUrl } from '../../ui/media';

export type NoticeTone = 'success' | 'error' | 'warning' | 'info';

/** Semantic colour for badges, status text and stat values. Colour only carries meaning; `neutral` is the default. */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

function toneClass(prefix: string, tone: Tone | undefined): string | false {
  return Boolean(tone) && tone !== 'neutral' && `${prefix}--${tone}`;
}

/**
 * Scrolls an editor card into view inside the Control Room content pane when
 * its top is off screen or under the sticky page bar. The pane's
 * scroll-padding keeps it clear of the bar.
 */
export function revealInContent(element: HTMLElement | null): void {
  const scroller = element?.closest('.admin-content');
  if (!element || !scroller) return;
  const top = element.getBoundingClientRect().top;
  const bounds = scroller.getBoundingClientRect();
  const bar = scroller.querySelector('.admin-page-header');
  const visibleTop = bar ? bar.getBoundingClientRect().bottom : bounds.top;
  if (top < visibleTop || top > bounds.bottom - 120) {
    element.scrollIntoView({ block: 'start' });
  }
}

// ------------------------------------------------------------ page header actions

const PageActionsContext = createContext<HTMLElement | null>(null);

/** AdminScreen provides the header's actions slot; pages fill it with <PageActions>. */
export const PageActionsProvider = PageActionsContext.Provider;

/**
 * Renders its children in the page header, right of the title (Refresh,
 * Export, Add...). Use it once per page, inside the page component.
 */
export function PageActions(props: { children: ReactNode }): JSX.Element | null {
  const target = useContext(PageActionsContext);
  return target ? createPortal(props.children, target) : null;
}

// ------------------------------------------------------------------ structure

/** A titled block of a page: h2, optional one-line description and actions, then the content. */
export function PageSection(props: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  const headingId = useId();
  return (
    <section id={props.id} className={classNames('admin-section', props.className)} aria-labelledby={headingId}>
      <header className="admin-section-header">
        <div className="admin-section-heading-group">
          <h2 className="admin-section-heading" id={headingId}>{props.title}</h2>
          {props.description && <p className="admin-section-description">{props.description}</p>}
        </div>
        {props.actions && <div className="admin-section-actions">{props.actions}</div>}
      </header>
      {props.children}
    </section>
  );
}

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'form' | 'ul' | 'ol';
  /**
   * `none` drops the padding, for tables and hairline lists that run edge to edge.
   * `rows` is for a panel of hairline rows (SwitchRow, value rows, a facts list).
   */
  padding?: 'default' | 'none' | 'rows';
}

/**
 * The raised surface (14px radius, subtle edge, soft depth): holds a table, a
 * grouped form or a list. Never nest panels. `rows` makes it a grouped inset
 * list: rows with inset hairlines whose highlight follows the panel's radius.
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel({ as = 'div', padding = 'default', className, ...rest }, ref) {
  const Element = as as 'div';
  return (
    <Element
      ref={ref as Ref<HTMLDivElement>}
      className={classNames('admin-panel', padding === 'none' && 'admin-panel--flush', padding === 'rows' && 'admin-panel--rows', className)}
      {...(rest as HTMLAttributes<HTMLDivElement>)}
    />
  );
});

/** A row of controls (filters, buttons). Put <ToolbarSpacer /> between groups to push the rest to the right. */
export function Toolbar(props: {
  children: ReactNode;
  align?: 'start' | 'end' | 'between';
  className?: string;
  'aria-label'?: string;
}): JSX.Element {
  return (
    <div
      className={classNames('admin-toolbar', props.align && props.align !== 'start' && `admin-toolbar--${props.align}`, props.className)}
      aria-label={props['aria-label']}
    >
      {props.children}
    </div>
  );
}

export function ToolbarSpacer(): JSX.Element {
  return <span className="admin-toolbar-spacer" aria-hidden="true" />;
}

// ---------------------------------------------------------------------- data

/** One panel split into equal cells by hairlines. Children are <Stat>s. */
export function StatRow(props: {
  children: ReactNode;
  /** Narrowest a cell gets before the row wraps (default 160px). */
  minCellWidth?: number;
  className?: string;
  'aria-label'?: string;
}): JSX.Element {
  const style = props.minCellWidth ? ({ '--a-stat-min': `${props.minCellWidth}px` } as CSSProperties) : undefined;
  return (
    <dl className={classNames('admin-stat-row', props.className)} style={style} aria-label={props['aria-label']}>
      {props.children}
    </dl>
  );
}

export function Stat(props: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Colours the value; only when it carries meaning (for example verified money). */
  tone?: Tone;
  /** Full value on hover when a text value may be cut off. */
  title?: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={classNames('admin-stat', props.className)}>
      <dt className="admin-stat-label">{props.label}</dt>
      <dd className={classNames('admin-stat-value', toneClass('admin-stat-value', props.tone))} title={props.title}>{props.value}</dd>
      {props.sub && <dd className="admin-stat-sub">{props.sub}</dd>}
    </div>
  );
}

/**
 * A state in words with an 8px dot: Completed, Active, Pending, Failed... The
 * tone follows the one status mapping in docs/admin-design.md. `icon` replaces
 * the dot where a mark says more (the verified check in Accounts).
 */
export function StatusText(props: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string; title?: string }): JSX.Element {
  return (
    <span className={classNames('admin-status', `admin-status--${props.tone ?? 'neutral'}`, props.className)} title={props.title}>
      {props.icon ?? <i className="admin-status-dot" aria-hidden="true" />}
      {props.children}
    </span>
  );
}

/** A small label for a fact about a row: "This device", "Removed", "Global". Not for counts or states. */
export function Badge(props: { tone?: Tone; children: ReactNode; className?: string; title?: string }): JSX.Element {
  return (
    <span className={classNames('admin-badge', toneClass('admin-badge', props.tone), props.className)} title={props.title}>
      {props.children}
    </span>
  );
}

// --------------------------------------------------------------------- forms

/** Label above a control, help or error below. */
export function Field(props: {
  label: ReactNode;
  /** Id of the control. When set the label points at it; otherwise the label wraps the control. */
  htmlFor?: string;
  required?: boolean;
  help?: ReactNode;
  /** Replaces the help text and marks the control invalid. */
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const label = (
    <>
      {props.label}
      {props.required && <span className="admin-field-required">Required</span>}
    </>
  );
  const note = props.error ? (
    <span className="admin-field-error" role="alert">{props.error}</span>
  ) : props.help ? (
    <span className="admin-field-help">{props.help}</span>
  ) : null;
  const className = classNames('admin-field', props.className);
  const invalid = props.error ? 'true' : undefined;

  if (props.htmlFor) {
    return (
      <div className={className} data-invalid={invalid}>
        <label className="admin-field-label" htmlFor={props.htmlFor}>{label}</label>
        {props.children}
        {note}
      </div>
    );
  }
  return (
    <label className={className} data-invalid={invalid}>
      <span className="admin-field-label">{label}</span>
      {props.children}
      {note}
    </label>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  /** Text only: segments carry no icons. */
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

/** One choice out of a few (scope, period, view). For on/off filters use ToggleChip. */
export function Segmented<T extends string>(props: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div className={classNames('admin-segmented', props.className)} role="group" aria-label={props['aria-label']}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === props.value}
          disabled={props.disabled || option.disabled}
          title={option.title}
          onClick={() => {
            if (option.value !== props.value) props.onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off filter chip. Selected chips get a leading check from CSS. Group them in .admin-chip-toggles. */
export function ToggleChip(props: {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className={classNames('admin-chip-toggle', props.className)}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      title={props.title}
      onClick={() => props.onChange(!props.pressed)}
    >
      {props.children}
    </button>
  );
}

export function SwitchRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className={classNames('admin-switch-row', props.disabled && 'is-disabled', props.className)}>
      <span className="admin-switch-copy">
        <strong>{props.label}</strong>
        {props.description && <small>{props.description}</small>}
      </span>
      <input
        className="admin-switch-input"
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="ps-switch" data-on={props.checked ? 'true' : 'false'} aria-hidden="true" />
    </label>
  );
}

/**
 * The bare 46x28 switch for table cells and toolbars, with an optional label
 * after it. SwitchRow is the settings-row version (copy left, switch right).
 */
export function InlineSwitch(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Visible text after the switch. */
  label?: ReactNode;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  title?: string;
  className?: string;
  /** Shows a spinner after the switch while the change saves (a switch has no words to change, unlike a text button). */
  busy?: boolean;
}): JSX.Element {
  return (
    <label className={classNames('admin-inline-switch', props.disabled && 'is-disabled', props.className)} title={props.title}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props['aria-label']}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="ps-switch" data-on={props.checked ? 'true' : 'false'} aria-hidden="true" />
      {props.label && <span className="admin-inline-switch-label">{props.label}</span>}
      {props.busy && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
    </label>
  );
}

// ------------------------------------------------------------------ feedback

const NOTICE_ICONS: Record<NoticeTone, JSX.Element> = {
  success: <CircleCheck size={15} />,
  error: <CircleAlert size={15} />,
  warning: <TriangleAlert size={15} />,
  info: <Info size={15} />
};

export function Notice(props: { tone: NoticeTone; children: ReactNode; className?: string }): JSX.Element {
  return (
    <p
      className={classNames('admin-notice', `admin-notice--${props.tone}`, props.className)}
      role={props.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="admin-notice-icon" aria-hidden="true">{NOTICE_ICONS[props.tone]}</span>
      <span>{props.children}</span>
    </p>
  );
}

export function EmptyState(props: {
  title: string;
  children?: ReactNode;
  /** Optional next step, usually one button. */
  action?: ReactNode;
  /** Optional 32px outline icon above the title (a lucide icon, no circle or tile behind it). */
  icon?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={classNames('admin-empty', props.className)}>
      {props.icon && <span className="admin-empty-icon" aria-hidden="true">{props.icon}</span>}
      <strong className="admin-empty-title">{props.title}</strong>
      {props.children && <p>{props.children}</p>}
      {props.action && <div className="admin-empty-action">{props.action}</div>}
    </div>
  );
}

export function LoadingState(props: { label: string; className?: string }): JSX.Element {
  return (
    <div className={classNames('admin-loading', props.className)} role="status">
      <LoaderCircle className="spin" size={14} aria-hidden="true" />
      <span>{props.label}</span>
    </div>
  );
}

// --------------------------------------------------------------------- media

export function ArtImage(props: { path?: string; className?: string; alt?: string; fallback: ReactNode }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const source = toFileUrl(props.path);

  useEffect(() => setFailed(false), [props.path]);

  return (
    <span className={props.className}>
      {source && !failed ? <img src={source} alt={props.alt ?? ''} onError={() => setFailed(true)} /> : props.fallback}
    </span>
  );
}
