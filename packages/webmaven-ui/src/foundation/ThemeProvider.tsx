import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { GlobalStyles } from './GlobalStyles';
import { GooeyFilters } from './GooeyFilters';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  /** GlobalStyles' fonts: a stylesheet to import, or null when the page loads them itself. */
  fontsHref?: string | null;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  // Atelier is a light-first system; dark is the opt-in second theme.
  defaultTheme = 'light',
  storageKey = 'webmaven-theme',
  fontsHref,
}) => {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {
      // localStorage unavailable
    }
    return defaultTheme;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme, storageKey]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <GlobalStyles fontsHref={fontsHref} />
      <GooeyFilters />
      {children}
    </ThemeContext.Provider>
  );
};
