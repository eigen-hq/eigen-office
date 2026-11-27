import { useSyncExternalStore } from 'react';

/**
 * A phone: a small touch screen, upright or across. A tablet or a computer works and is shown
 * to – the phone beside it shows.
 */
const PHONE = '(pointer: coarse) and (max-width: 767px), (pointer: coarse) and (max-height: 500px)';

const phoneQuery = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE)
    : null;

export const isPhone = (): boolean => phoneQuery()?.matches ?? false;

/** Whether this is a phone – on as it turns or the window changes. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = phoneQuery();
      query?.addEventListener('change', changed);
      return () => query?.removeEventListener('change', changed);
    },
    isPhone,
    () => false,
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
