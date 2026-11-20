import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  parseThemePreference,
  readStoredTheme,
  saveThemePreference,
  toggleThemePreference,
  type ThemeRootElementLike,
  type ThemeStorageLike,
} from './theme.ts';

function createMemoryStorage(initial: Record<string, string> = {}): ThemeStorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

test('parseThemePreference defaults to light for missing or unknown values', () => {
  assert.equal(parseThemePreference(null), 'light');
  assert.equal(parseThemePreference(undefined), 'light');
  assert.equal(parseThemePreference('sepia'), 'light');
  assert.equal(parseThemePreference('light'), 'light');
  assert.equal(parseThemePreference('dark'), 'dark');
});

test('readStoredTheme and saveThemePreference persist theme across sessions', () => {
  const storage = createMemoryStorage();
  assert.equal(readStoredTheme(storage), 'light');

  const okDark = saveThemePreference('dark', storage);
  assert.equal(okDark, true);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'dark');
  assert.equal(readStoredTheme(storage), 'dark');

  const okLight = saveThemePreference('light', storage);
  assert.equal(okLight, true);
  assert.equal(readStoredTheme(storage), 'light');
});

test('readStoredTheme handles throwing storage gracefully without crashing', () => {
  const brokenStorage: ThemeStorageLike = {
    getItem: () => {
      throw new Error('Quota or sandbox blocked');
    },
    setItem: () => {
      throw new Error('Quota or sandbox blocked');
    },
  };
  assert.equal(readStoredTheme(brokenStorage), 'light');
  assert.equal(saveThemePreference('dark', brokenStorage), false);
});

test('toggleThemePreference alternates between light and dark', () => {
  assert.equal(toggleThemePreference('light'), 'dark');
  assert.equal(toggleThemePreference('dark'), 'light');
});

test('applyThemeToDocument toggles .dark class, colorScheme, and data-theme attribute', () => {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const fakeRoot: ThemeRootElementLike = {
    classList: {
      toggle: (token: string, force?: boolean) => {
        const shouldAdd = force ?? !classes.has(token);
        if (shouldAdd) classes.add(token);
        else classes.delete(token);
        return shouldAdd;
      },
    },
    style: { colorScheme: '' },
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
  };

  applyThemeToDocument('dark', fakeRoot);
  assert.equal(classes.has('dark'), true);
  assert.equal(fakeRoot.style.colorScheme, 'dark');
  assert.equal(attrs.get('data-theme'), 'dark');

  applyThemeToDocument('light', fakeRoot);
  assert.equal(classes.has('dark'), false);
  assert.equal(fakeRoot.style.colorScheme, 'light');
  assert.equal(attrs.get('data-theme'), 'light');
});
