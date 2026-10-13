import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GameRecord } from '../../../shared/types';
import { toFileUrl } from '../../ui/media';

function artworkCandidates(game: GameRecord | null | undefined, kind: 'avatar' | 'cover'): string[] {
  if (!game) return [];
  const paths = kind === 'avatar'
    ? [game.avatarImagePath, game.coverImagePath]
    : [game.coverImagePath, game.avatarImagePath];
  return [...new Set(paths.filter((path): path is string => Boolean(path?.trim())))];
}

/**
 * Game art with graceful fallback: tries the preferred artwork, then the other
 * kind, then renders `fallback` when nothing loads.
 */
export function GameArtwork(props: {
  game?: GameRecord | null;
  kind: 'avatar' | 'cover';
  className?: string;
  fallback?: ReactNode;
}): JSX.Element {
  const candidates = useMemo(() => artworkCandidates(props.game, props.kind), [props.game, props.kind]);
  const candidateKey = candidates.join('|');
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => setCandidateIndex(0), [candidateKey]);

  const path = candidates[candidateIndex];
  if (!path) return <>{props.fallback ?? null}</>;

  return (
    <img
      className={props.className}
      src={toFileUrl(path)}
      alt=""
      draggable={false}
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  );
}
