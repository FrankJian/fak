import type { Density, Theme } from '../store/appStore';

export type ResolvedTheme = 'light' | 'dark' | 'highContrast';

/** SPEC §6.11：跟随系统时若检测到 prefers-contrast: more，自动选用高对比度。 */
export function resolveTheme(
  theme: Theme,
  prefersDark: boolean,
  prefersMoreContrast: boolean,
): ResolvedTheme {
  if (theme !== 'system') return theme;
  if (prefersMoreContrast) return 'highContrast';
  return prefersDark ? 'dark' : 'light';
}

export function applyAppearance(theme: ResolvedTheme, density: Density): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.density = density;
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
}
