import { useCallback, useSyncExternalStore } from 'react';

/**
 * Per-station launcher UI preferences. These are cosmetic and live in the
 * renderer's local storage, which the main launcher and the quick-overlay
 * window share, so no main-process settings migration is needed. The
 * Control Room theme (a three-way choice) is at the end of this file.
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

// ------------------------------------------------------------ Control Room theme

/**
 * Control Room colour theme, per station like the preferences above. `system`
 * follows prefers-color-scheme, which Electron takes from the Windows app
 * theme. Only the Control Room reads it; customer screens stay dark.
 */
export type AdminThemePreference = 'dark' | 'light' | 'system';
export type AdminTheme = 'dark' | 'light';

const ADMIN_THEME_KEY = `${STORAGE_PREFIX}adminTheme`;
const ADMIN_THEME_DEFAULT: AdminThemePreference = 'dark';
const ADMIN_THEME_PREFERENCES: readonly AdminThemePreference[] = ['dark', 'light', 'system'];

function isAdminThemePreference(value: unknown): value is AdminThemePreference {
  return ADMIN_THEME_PREFERENCES.includes(value as AdminThemePreference);
}

export function getAdminThemePreference(): AdminThemePreference {
  try {
    const raw = window.localStorage.getItem(ADMIN_THEME_KEY);
    return isAdminThemePreference(raw) ? raw : ADMIN_THEME_DEFAULT;
  } catch {
    return ADMIN_THEME_DEFAULT;
  }
}

export function setAdminThemePreference(value: AdminThemePreference): void {
  try {
    window.localStorage.setItem(ADMIN_THEME_KEY, value);
  } catch {
    // Storage can be unavailable; the open Control Room still switches below.
  }
  for (const listener of listeners) listener();
}

export function useAdminThemePreference(): [AdminThemePreference, (value: AdminThemePreference) => void] {
  const value = useSyncExternalStore(subscribe, getAdminThemePreference);
  return [value, setAdminThemePreference];
}

const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

function subscribeSystemTheme(listener: () => void): () => void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_SCHEME_QUERY) : null;
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}

function getSystemTheme(): AdminTheme {
  return typeof window.matchMedia === 'function' && window.matchMedia(LIGHT_SCHEME_QUERY).matches ? 'light' : 'dark';
}

/** The theme to render: the stored choice, with `system` following the OS live. */
export function useResolvedAdminTheme(preference: AdminThemePreference): AdminTheme {
  const system = useSyncExternalStore(subscribeSystemTheme, getSystemTheme);
  return preference === 'system' ? system : preference;
}
