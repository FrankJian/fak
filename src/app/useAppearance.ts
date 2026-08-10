import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { applyAppearance, resolveTheme } from '../lib/theme';

export function useAppearance(): void {
  const theme = useAppStore((s) => s.theme);
  const density = useAppStore((s) => s.density);

  useEffect(() => {
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const contrastQuery = window.matchMedia('(prefers-contrast: more)');

    const apply = () =>
      applyAppearance(resolveTheme(theme, darkQuery.matches, contrastQuery.matches), density);

    apply();
    darkQuery.addEventListener('change', apply);
    contrastQuery.addEventListener('change', apply);
    return () => {
      darkQuery.removeEventListener('change', apply);
      contrastQuery.removeEventListener('change', apply);
    };
  }, [theme, density]);
}
