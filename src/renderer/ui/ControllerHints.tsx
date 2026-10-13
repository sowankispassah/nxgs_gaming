import { ButtonGlyph, type GlyphName } from './ButtonGlyph';

export type ControllerHint = {
  glyph: GlyphName;
  label: string;
};

/**
 * Console-style button legend ("✕ Select  ○ Back"). Place it in a screen
 * footer, or pass `floating` to pin it to the bottom-right safe area.
 */
export function ControllerHints(props: {
  hints: ControllerHint[];
  floating?: boolean;
  className?: string;
}): JSX.Element {
  const classes = ['controller-hints'];
  if (props.floating) classes.push('controller-hints--floating');
  if (props.className) classes.push(props.className);
  return (
    <div className={classes.join(' ')} role="note" aria-label="Controller buttons">
      {props.hints.map((hint) => (
        <span className="controller-hint" key={`${hint.glyph}:${hint.label}`}>
          <ButtonGlyph name={hint.glyph} />
          <span>{hint.label}</span>
        </span>
      ))}
    </div>
  );
}
