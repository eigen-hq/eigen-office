import type { CompanionDesk, CompanionEvent } from '@slider/shared';
import { useSyncExternalStore } from 'react';

/**
 * The phone beside the computer („Begleiter“): what this tab last heard of the computer one works
 * at (event `companion` on the call stream, `call-client.ts`), and how often that stream opened –
 * a tab says again what it shows after each (the server may have restarted).
 */
interface CompanionHeard {
  desk: CompanionDesk | null;
  /** Counts the stream's openings. */
  opened: number;
}

let heard: CompanionHeard = { desk: null, opened: 0 };
const listeners = new Set<() => void>();

function set(next: CompanionHeard) {
  heard = next;
  for (const listener of listeners) listener();
}

/** The call stream said what the computer shows. */
export function hearCompanion(event: CompanionEvent) {
  set({ ...heard, desk: event.desk });
}

/** The call stream (re)opened. */
export function companionStreamOpened() {
  set({ ...heard, opened: heard.opened + 1 });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** What the computer shows, and the stream's openings. */
export const useCompanionHeard = (): CompanionHeard => useSyncExternalStore(subscribe, () => heard);

/** For tests: back to nothing heard. */
export function resetCompanion() {
  set({ desk: null, opened: 0 });
}
