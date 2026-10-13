import { useEffect, useRef, type CSSProperties } from 'react';
import { Clapperboard, Music2, Radio, Tv, type LucideIcon } from 'lucide-react';
import { tileSlotClass, useMeasuredWidth } from './homeUtils';

const MEDIA_APPS: Array<{ key: string; label: string; icon: LucideIcon }> = [
  { key: 'tv', label: 'TV & Video', icon: Tv },
  { key: 'movies', label: 'Movies', icon: Clapperboard },
  { key: 'music', label: 'Music', icon: Music2 },
  { key: 'live', label: 'Live events', icon: Radio }
];

/** Media tab: a TV & Video shelf of reserved app slots. */
export function MediaShelf(props: {
  focused: boolean;
  selectedIndex: number;
  onFocusIndex: (index: number) => void;
}): JSX.Element {
  const tileRefs = useRef<Array<HTMLElement | null>>([]);
  const selected = Math.max(0, Math.min(MEDIA_APPS.length - 1, props.selectedIndex));
  const app = MEDIA_APPS[selected];
  const [labelRef, labelWidth] = useMeasuredWidth<HTMLSpanElement>(app.key);

  useEffect(() => {
    if (!props.focused) return;
    tileRefs.current[selected]?.focus({ preventScroll: true });
  }, [props.focused, selected]);

  return (
    <section className="media-shelf" aria-label="TV and video">
      <div
        className={`console-tile-row media-tile-row ${props.focused ? 'keyboard-focus' : ''}`}
        style={{ '--label-w': `${labelWidth}px` } as CSSProperties}
      >
        {MEDIA_APPS.map((item, index) => {
          const Icon = item.icon;
          const slot = index - selected;
          return (
            <article
              ref={(element) => {
                tileRefs.current[index] = element;
              }}
              key={item.key}
              className={`console-tile media-tile ${tileSlotClass(slot)}`}
              style={{ '--slot': slot } as CSSProperties}
              tabIndex={-1}
              aria-label={`${item.label}, coming soon`}
              onFocus={() => props.onFocusIndex(index)}
              onClick={() => props.onFocusIndex(index)}
            >
              <span className="console-tile-art media-tile-art">
                <Icon size={56} strokeWidth={1.4} />
              </span>
            </article>
          );
        })}
        <span ref={labelRef} key={app.key} className="console-row-label" aria-hidden="true">
          <span className="console-row-label-title">{app.label}</span>
          <span className="console-row-label-sub">Coming soon</span>
        </span>
      </div>
      <div className="media-placeholder">
        <p className="eyebrow">NXGS Media</p>
        <h1>Media coming soon</h1>
        <span>This space is reserved for a future NXGS entertainment experience.</span>
      </div>
    </section>
  );
}
