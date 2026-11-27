import { useSyncExternalStore } from 'react';

/**
 * A phone: a small touch screen, upright or across – it shows what goes with the computer.
 * A tablet: touch alone, bigger (no mouse or trackpad at it) – it is offered the companion, never
 * turned into it, and never counts as the computer one works at. Anything else is that computer.
 */
const PHONE = '(pointer: coarse) and (max-width: 767px), (pointer: coarse) and (max-height: 500px)';
const TOUCH = '(pointer: coarse)';
const FINE = '(any-pointer: fine)';

export type Device = 'phone' | 'tablet' | 'desk';

const media = (query: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;

export function device(): Device {
  if (media(PHONE)?.matches) return 'phone';
  return media(TOUCH)?.matches && !media(FINE)?.matches ? 'tablet' : 'desk';
}

/** What this is – on as it turns, the window changes or a mouse comes and goes. */
export function useDevice(): Device {
  return useSyncExternalStore(
    (changed) => {
      const queries = [PHONE, TOUCH, FINE].map(media);
      for (const query of queries) query?.addEventListener('change', changed);
      return () => {
        for (const query of queries) query?.removeEventListener('change', changed);
      };
    },
    device,
    () => 'desk',
  );
}

/** The tab is the one in front: seen and focused. */
export const inFront = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();

/** Whether the tab is in front – on with focus, blur and the tab shown or hidden. */
export function useInFront(): boolean {
  return useSyncExternalStore(
    (changed) => {
      window.addEventListener('focus', changed);
      window.addEventListener('blur', changed);
      document.addEventListener('visibilitychange', changed);
      return () => {
        window.removeEventListener('focus', changed);
        window.removeEventListener('blur', changed);
        document.removeEventListener('visibilitychange', changed);
      };
    },
    inFront,
    () => false,
  );
}
