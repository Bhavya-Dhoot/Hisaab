import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

function readInitial(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readInitial);

  const toggle = useCallback(() => {
    setTheme((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('hisab-theme', next);
      } catch {
        // ignore, storage may be unavailable (private mode, disabled storage)
      }
      return next;
    });
  }, []);

  return [theme, toggle];
}
