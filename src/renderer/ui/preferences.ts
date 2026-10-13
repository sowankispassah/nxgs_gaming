import { useCallback, useSyncExternalStore } from 'react';

/**
 * Per-station launcher UI preferences. These are cosmetic and live in the
 * renderer's local storage, which the main launcher and the quick-overlay
 * window share, so no main-process settings migration is needed.
 */
export type UiPreferenceKey = 'uiSounds' | 'reduceMotion';

const DEFAULTS: Record<UiPreferenceKey, boolean> = {
  uiSounds: true,
  reduceMotion: false
};

const STORAGE_PREFIX = 'nxgs.ui.';
const listeners = new Set<() => void>();

export function getUiPreference(key: UiPreferenceKey): boolean {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    return raw === null ? DEFAULTS[key] : raw === 'true';
  } catch {
    return DEFAULTS[key];
  }
}

export function applyDocumentPreferences(): void {
  document.documentElement.dataset.reduceMotion = String(getUiPreference('reduceMotion'));
}

export function setUiPreference(key: UiPreferenceKey, value: boolean): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(value));
  } catch {
    // Storage can be unavailable; the in-memory UI still updates below.
  }
  applyDocumentPreferences();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key?.startsWith(STORAGE_PREFIX)) {
      applyDocumentPreferences();
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useUiPreference(key: UiPreferenceKey): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => getUiPreference(key));
  const update = useCallback((next: boolean) => setUiPreference(key, next), [key]);
  return [value, update];
}
