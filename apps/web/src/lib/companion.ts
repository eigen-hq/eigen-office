import type {
  CompanionCommand,
  CompanionDesk,
  CompanionEvent,
  CompanionShow,
} from '@slider/shared';
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
  setCompanionShow(null);
}

/*
 * What the phone asks of this tab (event `companion-command`, only to the computer tab it shows):
 * heard by whoever can do it – a slide show running (`useShowRemote`), the page („Am Computer
 * öffnen“, `useCompanionCommands`).
 */
const asked = new Set<(command: CompanionCommand) => void>();

/** The call stream handed this tab a command. */
export function hearCompanionCommand(command: CompanionCommand) {
  for (const listener of asked) listener(command);
}

/** Listens to the phone's commands; returns the stop. */
export function onCompanionCommand(listener: (command: CompanionCommand) => void): () => void {
  asked.add(listener);
  return () => asked.delete(listener);
}

/*
 * A slide show running in this tab: where it is, told to the phone with the page
 * (`features/companion/lib/report.ts`). Set by the show, `null` once it ends.
 */
let show: CompanionShow | null = null;
const showListeners = new Set<() => void>();

export function setCompanionShow(next: CompanionShow | null) {
  if (JSON.stringify(next) === JSON.stringify(show)) return;
  show = next;
  for (const listener of showListeners) listener();
}

const subscribeShow = (listener: () => void) => {
  showListeners.add(listener);
  return () => showListeners.delete(listener);
};

/** The slide show running in this tab, if one is. */
export const useCompanionShow = (): CompanionShow | null =>
  useSyncExternalStore(subscribeShow, () => show);
