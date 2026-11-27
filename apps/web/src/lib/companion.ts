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

/** The stream gone this long (offline, the server away): no computer heard – none is kept. */
const LOST_MS = 15_000;
let lostTimer: ReturnType<typeof setTimeout> | undefined;

/** The call stream said what the computer shows. */
export function hearCompanion(event: CompanionEvent) {
  set({ ...heard, desk: event.desk });
}

/** The call stream (re)opened. */
export function companionStreamOpened() {
  clearTimeout(lostTimer);
  set({ ...heard, opened: heard.opened + 1 });
}

/**
 * The call stream broke: what was heard of the computer counts no more unless it comes back soon
 * (a blip reconnects and hears it again) – the phone does not keep its screen on or open the
 * companion on an old word.
 */
export function companionStreamLost() {
  clearTimeout(lostTimer);
  lostTimer = setTimeout(() => {
    if (heard.desk) set({ ...heard, desk: null });
  }, LOST_MS);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** What the computer shows, and the stream's openings. */
export const useCompanionHeard = (): CompanionHeard => useSyncExternalStore(subscribe, () => heard);

/** What the computer shows, outside React; and listening to it (returns the stop). */
export const companionHeard = (): CompanionHeard => heard;
export const onCompanionHeard = (listener: () => void): (() => void) => subscribe(listener);

/** For tests: back to nothing heard. */
export function resetCompanion() {
  clearTimeout(lostTimer);
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
