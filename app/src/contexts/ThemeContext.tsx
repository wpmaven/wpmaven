import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

// Types
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
}

export interface ThemePreferences {
  mode: ThemeMode;
  accentColor: string;
  fontSize: 'small' | 'medium' | 'large';
  reducedMotion: boolean;
  compactMode: boolean;
}

interface ThemeState {
  mode: ThemeMode;
  resolvedMode: 'light' | 'dark'; // Actual mode after resolving 'system'
  preferences: ThemePreferences;
  colors: ThemeColors;
}

interface ThemeContextValue extends ThemeState {
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setAccentColor: (color: string) => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setReducedMotion: (reduced: boolean) => void;
  setCompactMode: (compact: boolean) => void;
  resetPreferences: () => void;
}

const STORAGE_KEY = 'webmaven-theme-preferences';

// Default colors
const LIGHT_COLORS: ThemeColors = {
  primary: '#3B82F6',
  secondary: '#6366F1',
  accent: '#8B5CF6',
  background: '#F9FAFB',
  surface: '#FFFFFF',
  text: '#111827',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
};

const DARK_COLORS: ThemeColors = {
  primary: '#60A5FA',
  secondary: '#818CF8',
  accent: '#A78BFA',
  background: '#111827',
  surface: '#1F2937',
  text: '#F9FAFB',
  textSecondary: '#9CA3AF',
  border: '#374151',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
};

const defaultPreferences: ThemePreferences = {
  mode: 'system',
  accentColor: '#3B82F6',
  fontSize: 'medium',
  reducedMotion: false,
  compactMode: false,
};

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return getSystemTheme();
  }
  return mode;
}

function getColors(resolvedMode: 'light' | 'dark', accentColor: string): ThemeColors {
  const baseColors = resolvedMode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  return {
    ...baseColors,
    primary: accentColor,
  };
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preferences, setPreferences] = useState<ThemePreferences>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...defaultPreferences, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load theme preferences:', e);
    }
    return defaultPreferences;
  });

  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>(() =>
    resolveMode(preferences.mode)
  );

  // Listen for system theme changes
  useEffect(() => {
    if (preferences.mode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setResolvedMode(getSystemTheme());
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [preferences.mode]);

  // Update resolved mode when preference changes
  useEffect(() => {
    setResolvedMode(resolveMode(preferences.mode));
  }, [preferences.mode]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    const colors = getColors(resolvedMode, preferences.accentColor);

    // Set data attribute for CSS selectors
    root.setAttribute('data-theme', resolvedMode);

    // Sync with webmaven-ui ThemeProvider storage
    try { localStorage.setItem('webmaven-theme', resolvedMode); } catch {}

    // Set CSS variables
    root.style.setProperty('--wpm-primary', colors.primary);
    root.style.setProperty('--wpm-secondary', colors.secondary);
    root.style.setProperty('--wpm-accent', colors.accent);
    root.style.setProperty('--wpm-bg', colors.background);
    root.style.setProperty('--wpm-surface', colors.surface);
    root.style.setProperty('--wpm-text', colors.text);
    root.style.setProperty('--wpm-text-secondary', colors.textSecondary);
    root.style.setProperty('--wpm-border', colors.border);
    root.style.setProperty('--wpm-success', colors.success);
    root.style.setProperty('--wpm-warning', colors.warning);
    root.style.setProperty('--wpm-error', colors.error);

    // Font size
    const fontSizes = { small: '14px', medium: '16px', large: '18px' };
    root.style.setProperty('--wpm-font-size-base', fontSizes[preferences.fontSize]);

    // Reduced motion
    if (preferences.reducedMotion) {
      root.style.setProperty('--wpm-transition-duration', '0ms');
    } else {
      root.style.setProperty('--wpm-transition-duration', '200ms');
    }

    // Compact mode
    if (preferences.compactMode) {
      root.setAttribute('data-compact', 'true');
    } else {
      root.removeAttribute('data-compact');
    }
  }, [resolvedMode, preferences]);

  // Persist preferences
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (e) {
      console.warn('Failed to save theme preferences:', e);
    }
  }, [preferences]);

  const setMode = useCallback((mode: ThemeMode) => {
    setPreferences(prev => ({ ...prev, mode }));
  }, []);

  const toggleMode = useCallback(() => {
    setPreferences(prev => ({
      ...prev,
      mode: prev.mode === 'light' ? 'dark' : prev.mode === 'dark' ? 'system' : 'light',
    }));
  }, []);

  const setAccentColor = useCallback((accentColor: string) => {
    setPreferences(prev => ({ ...prev, accentColor }));
  }, []);

  const setFontSize = useCallback((fontSize: 'small' | 'medium' | 'large') => {
    setPreferences(prev => ({ ...prev, fontSize }));
  }, []);

  const setReducedMotion = useCallback((reducedMotion: boolean) => {
    setPreferences(prev => ({ ...prev, reducedMotion }));
  }, []);

  const setCompactMode = useCallback((compactMode: boolean) => {
    setPreferences(prev => ({ ...prev, compactMode }));
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences(defaultPreferences);
  }, []);

  const colors = getColors(resolvedMode, preferences.accentColor);

  const value: ThemeContextValue = {
    mode: preferences.mode,
    resolvedMode,
    preferences,
    colors,
    setMode,
    toggleMode,
    setAccentColor,
    setFontSize,
    setReducedMotion,
    setCompactMode,
    resetPreferences,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export default ThemeContext;
