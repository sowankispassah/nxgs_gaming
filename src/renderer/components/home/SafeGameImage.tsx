import { useMemo, useState, type CSSProperties } from 'react';
import { Gamepad2 } from 'lucide-react';
import type { GameRecord } from '../../../shared/types';
import { toFileUrl } from '../../ui/media';
import { imageCandidates, placeholderHue } from './homeUtils';

/**
 * Game artwork that walks through the saved avatar/cover paths and falls back
 * to a generated tile when none of them can be loaded.
 */
export function SafeGameImage(props: {
  game: GameRecord;
  kind: 'avatar' | 'cover';
  alt: string;
  fallbackSize?: number;
}): JSX.Element {
  const candidates = useMemo(() => imageCandidates(props.game, props.kind), [props.game, props.kind]);
  const candidateKey = candidates.join('|');
  const [failure, setFailure] = useState({ key: candidateKey, index: 0 });
  const candidateIndex = failure.key === candidateKey ? failure.index : 0;
  const path = candidates[candidateIndex];

  if (!path) {
    return (
      <span
        className="nxgs-image-placeholder"
        style={{ '--placeholder-hue': placeholderHue(props.game.title) } as CSSProperties}
        aria-label={`${props.game.title} placeholder`}
      >
        <Gamepad2 size={props.fallbackSize ?? 34} strokeWidth={1.6} />
      </span>
    );
  }

  return (
    <img
      src={toFileUrl(path)}
      alt={props.alt}
      draggable={false}
      onError={() => setFailure({ key: candidateKey, index: candidateIndex + 1 })}
    />
  );
}
