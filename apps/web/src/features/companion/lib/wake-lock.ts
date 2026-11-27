import { useEffect } from 'react';

/**
 * Keeps the screen on while `on` (the companion on its stand beside the computer): the browser
 * lets go of the lock whenever the tab is hidden, so it is asked for again each time the tab is
 * seen. Where the browser has none (older Safari), the screen goes off as it would.
 */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    // Asked and not answered yet: not asked twice (the second lock would never be let go).
    let asking = false;
    const take = () => {
      if (asking || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      asking = true;
      navigator.wakeLock
        .request('screen')
        .then((taken) => {
          if (live) lock = taken;
          else void taken.release().catch(() => undefined);
        })
        // Refused (low battery, no gesture yet on some browsers): the next time the tab is seen.
        .catch(() => undefined)
        .finally(() => {
          asking = false;
        });
    };
    take();
    document.addEventListener('visibilitychange', take);
    // Some browsers refuse it before the first touch: asked again on it.
    window.addEventListener('pointerdown', take);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', take);
      window.removeEventListener('pointerdown', take);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
}
