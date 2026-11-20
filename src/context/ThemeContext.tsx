import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  type ThemePreference,
  applyThemeToDocument,
  parseThemePreference,
  readStoredTheme,
  saveThemePreference,
  toggleThemePreference,
} from '../utils/theme';

interface ThemeContextValue {
  theme: ThemePreference;
  isDark: boolean;
  setTheme: (next: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme());

  useEffect(() => {
    applyThemeToDocument(theme);
    saveThemePreference(theme);
  }, [theme]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        setThemeState(parseThemePreference(e.newValue));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    const normalized = parseThemePreference(next);
    setThemeState(normalized);
    applyThemeToDocument(normalized);
    saveThemePreference(normalized);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = toggleThemePreference(prev);
      applyThemeToDocument(next);
      saveThemePreference(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: 'light',
      isDark: false,
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}
