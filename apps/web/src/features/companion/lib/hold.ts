import type { CompanionView } from '@slider/shared';
import { useEffect, useState } from 'react';
import { BUSY_MS } from './auto';

/** What the phone shows of a view – a new one is another page (a deck's slide is not). */
const holdKey = (view: CompanionView | null) =>
  view ? `${view.kind}:${view.id ?? ''}:${view.kind === 'deck' ? '' : (view.sub ?? '')}` : '';

/**
 * The companion does not change under one's finger: while the phone is touched or typed on (and
 * a moment after), a new page on the computer waits – `waiting`, said in a bar with „Zeigen“ – and
 * the one in hand stays. Left alone, the phone follows the computer again.
 */
export function useHeldView(live: CompanionView | null) {
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(0);
  const [held, setHeld] = useState<CompanionView | null>(null);
  useEffect(() => {
    const touch = () => {
      setBusy(true);
      setTouched((count) => count + 1);
    };
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('keydown', touch, true);
    return () => {
      window.removeEventListener('pointerdown', touch, true);
      window.removeEventListener('keydown', touch, true);
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setBusy(false), BUSY_MS);
    return () => window.clearTimeout(timer);
  }, [busy, touched]);
  // Set while rendering, as busy comes and goes: what is in hand when the touching began.
  if (busy && !held && live) setHeld(live);
  if (!busy && held) setHeld(null);
  const away = !!held && holdKey(held) !== holdKey(live);
  return {
    view: away ? held : live,
    waiting: away ? live : null,
    show: () => setHeld(live),
  };
}
