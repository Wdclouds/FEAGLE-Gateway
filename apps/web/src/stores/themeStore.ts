import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ThemeMode = 'dark' | 'light';
export type AccentPreset = 'blue' | 'emerald' | 'cyan' | 'purple' | 'amber' | 'rose';

export interface AccentColorConfig {
  id: AccentPreset;
  name: string;
  lightPrimary: string;
  lightHover: string;
  darkPrimary: string;
  darkHover: string;
}

export const ACCENT_PRESETS: Record<AccentPreset, AccentColorConfig> = {
  blue: {
    id: 'blue',
    name: '科技蓝 (默认)',
    lightPrimary: '#2563eb',
    lightHover: '#1d4ed8',
    darkPrimary: '#3b82f6',
    darkHover: '#2563eb',
  },
  emerald: {
    id: 'emerald',
    name: '黑客绿',
    lightPrimary: '#059669',
    lightHover: '#047857',
    darkPrimary: '#10b981',
    darkHover: '#059669',
  },
  cyan: {
    id: 'cyan',
    name: '赛博青',
    lightPrimary: '#0891b2',
    lightHover: '#0e7490',
    darkPrimary: '#06b6d4',
    darkHover: '#0891b2',
  },
  purple: {
    id: 'purple',
    name: '电光紫',
    lightPrimary: '#7c3aed',
    lightHover: '#6d28d9',
    darkPrimary: '#8b5cf6',
    darkHover: '#7c3aed',
  },
  amber: {
    id: 'amber',
    name: '落日橙',
    lightPrimary: '#d97706',
    lightHover: '#b45309',
    darkPrimary: '#f59e0b',
    darkHover: '#d97706',
  },
  rose: {
    id: 'rose',
    name: '霓虹红',
    lightPrimary: '#e11d48',
    lightHover: '#be123c',
    darkPrimary: '#f43f5e',
    darkHover: '#e11d48',
  },
};

export const useThemeStore = defineStore('theme', () => {
  const savedMode = (localStorage.getItem('feagle_theme_mode') as ThemeMode) || 'dark';
  const savedAccent = (localStorage.getItem('feagle_theme_accent') as AccentPreset) || 'blue';

  const mode = ref<ThemeMode>(savedMode);
  const accent = ref<AccentPreset>(savedAccent in ACCENT_PRESETS ? savedAccent : 'blue');

  function applyTheme() {
    const root = document.documentElement;
    const isDark = mode.value === 'dark';

    if (isDark) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    root.dataset.theme = mode.value;
    root.dataset.accent = accent.value;

    const accentCfg = ACCENT_PRESETS[accent.value] || ACCENT_PRESETS.blue;
    const primary = isDark ? accentCfg.darkPrimary : accentCfg.lightPrimary;
    const hover = isDark ? accentCfg.darkHover : accentCfg.lightHover;

    root.style.setProperty('--color-accent', primary);
    root.style.setProperty('--color-accent-hover', hover);
    root.style.setProperty('--color-accent-subtle', isDark ? `${primary}26` : `${primary}18`);

    localStorage.setItem('feagle_theme_mode', mode.value);
    localStorage.setItem('feagle_theme_accent', accent.value);
  }

  function setMode(newMode: ThemeMode) {
    mode.value = newMode;
    applyTheme();
  }

  function toggleMode() {
    setMode(mode.value === 'dark' ? 'light' : 'dark');
  }

  function setAccent(newAccent: AccentPreset) {
    accent.value = newAccent;
    applyTheme();
  }

  return {
    mode,
    accent,
    applyTheme,
    setMode,
    toggleMode,
    setAccent,
  };
});
