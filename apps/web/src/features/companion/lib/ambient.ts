import { useEffect, useState } from 'react';

/** Untouched this long (and the computer showing the same): it rests. */
export const AMBIENT_MS = 2 * 60_000;
/**
 * Whether the companion rests: `key` – what the computer shows (a new one wakes it), `held` –
 * never now (a slide show, a panel open).
 */
export function useAmbient(key: string, held: boolean) {
  const [resting, setResting] = useState(false);
  const [touched, setTouched] = useState(0);
  const [seen, setSeen] = useState(key);
  // A new page on the computer: awake (set while rendering, as the key changes).
  if (seen !== key) {
    setSeen(key);
    setResting(false);
  }
  useEffect(() => {
    const touch = () => setTouched((count) => count + 1);
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('keydown', touch, true);
    return () => {
      window.removeEventListener('pointerdown', touch, true);
      window.removeEventListener('keydown', touch, true);
    };
  }, []);
  useEffect(() => {
    if (held || resting) return;
    const timer = window.setTimeout(() => setResting(true), AMBIENT_MS);
    return () => window.clearTimeout(timer);
  }, [held, resting, touched, key]);
  return { resting: resting && !held, wake: () => setResting(false) };
}
