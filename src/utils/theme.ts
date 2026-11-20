export const THEME_STORAGE_KEY = 'avy_infra_theme';

export type ThemePreference = 'light' | 'dark';

export interface ThemeStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === 'dark' ? 'dark' : 'light';
}

export function readStoredTheme(storage?: ThemeStorageLike | null): ThemePreference {
  const target =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
        ? window.localStorage
        : null;
  if (!target) return 'light';
  try {
    return parseThemePreference(target.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'light';
  }
}

export function saveThemePreference(
  theme: ThemePreference,
  storage?: ThemeStorageLike | null
): boolean {
  const normalized = parseThemePreference(theme);
  const target =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
        ? window.localStorage
        : null;
  if (!target) return false;
  try {
    target.setItem(THEME_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export function toggleThemePreference(current: ThemePreference): ThemePreference {
  return current === 'dark' ? 'light' : 'dark';
}

export interface ThemeRootElementLike {
  classList: {
    toggle: (token: string, force?: boolean) => boolean | void;
  };
  style: {
    colorScheme: string;
  };
  setAttribute?: (name: string, value: string) => void;
}

export function applyThemeToDocument(
  theme: ThemePreference,
  rootEl?: ThemeRootElementLike | null
): ThemePreference {
  const normalized = parseThemePreference(theme);
  const el =
    rootEl !== undefined
      ? rootEl
      : typeof document !== 'undefined'
        ? document.documentElement
        : null;
  if (el) {
    el.classList.toggle('dark', normalized === 'dark');
    el.style.colorScheme = normalized;
    el.setAttribute?.('data-theme', normalized);
  }
  return normalized;
}
