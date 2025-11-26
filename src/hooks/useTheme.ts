/**
 * useTheme - 主题管理 Hook
 * 
 * 支持：系统跟随、浅色、深色三种模式
 */

import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'geocommander-theme';

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY) as ThemeMode;
    return saved || 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

  // 获取系统主题
  const getSystemTheme = useCallback((): 'light' | 'dark' => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return 'dark';
  }, []);

  // 应用主题
  useEffect(() => {
    const applyTheme = () => {
      let theme: 'light' | 'dark';
      
      if (mode === 'system') {
        theme = getSystemTheme();
      } else {
        theme = mode;
      }

      setResolvedTheme(theme);
      document.documentElement.setAttribute('data-theme', theme);
    };

    applyTheme();

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => {
      if (mode === 'system') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mode, getSystemTheme]);

  // 切换主题
  const setTheme = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
    localStorage.setItem(THEME_KEY, newMode);
  }, []);

  // 循环切换
  const toggleTheme = useCallback(() => {
    const modes: ThemeMode[] = ['system', 'light', 'dark'];
    const currentIndex = modes.indexOf(mode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setTheme(modes[nextIndex]);
  }, [mode, setTheme]);

  return {
    mode,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isDark: resolvedTheme === 'dark'
  };
}
