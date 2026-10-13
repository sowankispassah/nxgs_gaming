import type { CSSProperties } from 'react';

export type GlyphName =
  | 'cross'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'options'
  | 'home'
  | 'dpad'
  | 'dpad-vertical'
  | 'dpad-horizontal'
  | 'l1'
  | 'r1';

const FACE_COLORS: Partial<Record<GlyphName, string>> = {
  cross: 'var(--glyph-cross)',
  circle: 'var(--glyph-circle)',
  square: 'var(--glyph-square)',
  triangle: 'var(--glyph-triangle)'
};

function FaceSymbol(props: { name: GlyphName; color: string }): JSX.Element | null {
  const stroke = { stroke: props.color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (props.name) {
    case 'cross':
      return <path d="M8.4 8.4 15.6 15.6M15.6 8.4 8.4 15.6" {...stroke} />;
    case 'circle':
      return <circle cx="12" cy="12" r="4.4" {...stroke} />;
    case 'square':
      return <rect x="7.8" y="7.8" width="8.4" height="8.4" rx="0.8" {...stroke} />;
    case 'triangle':
      return <path d="M12 7.4 16.6 15.4H7.4Z" {...stroke} />;
    default:
      return null;
  }
}

/**
 * Controller button artwork used in on-screen hints. Face buttons render as a
 * dark disc with the coloured symbol; pass `mono` for an all-white variant.
 */
export function ButtonGlyph(props: {
  name: GlyphName;
  size?: number;
  mono?: boolean;
  className?: string;
  title?: string;
}): JSX.Element {
  const size = props.size ?? 26;
  const style = { '--glyph-size': `${size}px` } as CSSProperties;
  const className = `button-glyph button-glyph--${props.name}${props.className ? ` ${props.className}` : ''}`;
  const color = props.mono ? 'currentColor' : FACE_COLORS[props.name] ?? 'currentColor';

  if (props.name === 'l1' || props.name === 'r1') {
    return (
      <span className={`${className} button-glyph--shoulder`} style={style} title={props.title} aria-hidden={props.title ? undefined : true}>
        {props.name.toUpperCase()}
      </span>
    );
  }

  let artwork: JSX.Element;
  if (props.name === 'options') {
    artwork = (
      <svg viewBox="0 0 24 24" width={size} height={size} focusable="false">
        <rect x="2.5" y="5.5" width="19" height="13" rx="6.5" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
        <path d="M8 9.6h8M8 12h8M8 14.4h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  } else if (props.name === 'home') {
    artwork = (
      <svg viewBox="0 0 24 24" width={size} height={size} focusable="false">
        <circle cx="12" cy="12" r="10.5" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
        <path d="M7.6 11.6 12 7.8l4.4 3.8V16a.6.6 0 0 1-.6.6h-2.3v-3h-3v3H8.2a.6.6 0 0 1-.6-.6Z" fill="currentColor" />
      </svg>
    );
  } else if (props.name.startsWith('dpad')) {
    const vertical = props.name === 'dpad' || props.name === 'dpad-vertical';
    const horizontal = props.name === 'dpad' || props.name === 'dpad-horizontal';
    artwork = (
      <svg viewBox="0 0 24 24" width={size} height={size} focusable="false">
        <path
          d="M9.4 3.5h5.2v5.9h5.9v5.2h-5.9v5.9H9.4v-5.9H3.5V9.4h5.9Z"
          fill="rgba(255,255,255,0.12)"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        {vertical && <path d="M12 5.4 13.6 7.6h-3.2ZM12 18.6l1.6-2.2h-3.2Z" fill="currentColor" />}
        {horizontal && <path d="M5.4 12l2.2-1.6v3.2ZM18.6 12l-2.2-1.6v3.2Z" fill="currentColor" />}
      </svg>
    );
  } else {
    artwork = (
      <svg viewBox="0 0 24 24" width={size} height={size} focusable="false">
        <circle cx="12" cy="12" r="10.5" fill="rgba(10,14,22,0.55)" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
        <FaceSymbol name={props.name} color={color} />
      </svg>
    );
  }

  return (
    <span className={className} style={style} title={props.title} aria-hidden={props.title ? undefined : true}>
      {artwork}
    </span>
  );
}
