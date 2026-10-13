import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameRecord } from '../../../shared/types';
import { toFileUrl } from '../../ui/media';
import { imageCandidates } from './homeUtils';

const HERO_SETTLE_MS = 760;

type HeroLayer = {
  id: number;
  path: string;
  leaving: boolean;
};

/**
 * Full-bleed key art behind Home. A new cover is preloaded, then crossfaded in
 * over the previous one with a slight settle zoom. With no usable art the
 * ambient console theme shows through instead of an empty screen.
 */
export function GameHeroBackground(props: { game: GameRecord | null }): JSX.Element {
  const candidates = useMemo(() => imageCandidates(props.game, 'cover'), [props.game]);
  const candidateKey = candidates.join('|');
  const [layers, setLayers] = useState<HeroLayer[]>([]);
  const layerSequence = useRef(0);
  const committedPath = useRef('');
  const cleanupTimers = useRef(new Set<number>());

  useEffect(() => {
    const timers = cleanupTimers.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const scheduleCleanup = (apply: () => void): void => {
      const timer = window.setTimeout(() => {
        cleanupTimers.current.delete(timer);
        apply();
      }, HERO_SETTLE_MS);
      cleanupTimers.current.add(timer);
    };

    const commit = (path: string): void => {
      if (cancelled || path === committedPath.current) return;
      committedPath.current = path;
      const id = ++layerSequence.current;
      if (!path) {
        setLayers((current) => current.map((layer) => ({ ...layer, leaving: true })));
        scheduleCleanup(() => setLayers((current) => current.filter((layer) => !layer.leaving || layer.id > id)));
        return;
      }
      setLayers((current) => {
        const kept = current.length > 2 ? [current[0], current[current.length - 1]] : current;
        return [...kept, { id, path, leaving: false }];
      });
      scheduleCleanup(() => setLayers((current) => (
        current.some((layer) => layer.id === id) ? current.filter((layer) => layer.id >= id) : current
      )));
    };

    const loadCandidate = (index: number): void => {
      const path = candidates[index];
      if (!path) {
        commit('');
        return;
      }
      const image = new Image();
      image.src = toFileUrl(path);
      image.decode().then(
        () => commit(path),
        () => {
          if (!cancelled) loadCandidate(index + 1);
        }
      );
    };

    loadCandidate(0);
    return () => {
      cancelled = true;
    };
  }, [candidateKey]);

  const showingArt = layers.some((layer) => !layer.leaving);

  return (
    <div className={`game-hero-background ${showingArt ? 'has-art' : 'ambient'}`} aria-hidden="true">
      <div className="hero-ambient">
        <span className="hero-ambient-glow" />
        <span className="hero-ambient-wave" />
      </div>
      {layers.map((layer) => (
        <img
          key={layer.id}
          className={`hero-image ${layer.leaving ? 'leaving' : ''}`}
          src={toFileUrl(layer.path)}
          alt=""
          draggable={false}
          onError={() => {
            if (committedPath.current === layer.path) committedPath.current = '';
            setLayers((current) => current.filter((item) => item.id !== layer.id));
          }}
        />
      ))}
      <div className="hero-scrim" />
      <div className="hero-dim" />
    </div>
  );
}
