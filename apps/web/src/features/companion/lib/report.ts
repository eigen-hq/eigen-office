import { COMPANION_RECENT_MS, type CompanionReport, type CompanionView } from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useCallsOrNull } from '@/features/calls';
import { api } from '@/lib/api-client';
import { onCallHere, ownCallHere } from '@/lib/call-here';
import { useCompanionHeard } from '@/lib/companion';
import { useActiveWorkspace } from '@/features/workspaces';
import { useInFront } from './device';
import { viewOf } from './view';

/** Changes come in bursts (a route, its title, its lines): told once they settle. */
const SETTLE_MS = 400;
/** Moves of the mouse count as use at most this often. */
const INPUT_EVERY_MS = 5_000;

/** The person works at this tab: it is in front and was used a moment ago. */
function useInUse(on: boolean): boolean {
  const front = useInFront();
  const [usedAt, setUsedAt] = useState(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    let last = 0;
    const used = () => {
      const now = Date.now();
      if (now - last < INPUT_EVERY_MS) return;
      last = now;
      setUsedAt(now);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll'] as const;
    for (const event of events)
      window.addEventListener(event, used, { capture: true, passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, used, { capture: true });
    };
  }, [on]);
  // Unused for a while: no longer in use – said once the time ran out.
  useEffect(() => {
    if (!on || !front) return;
    const timer = window.setTimeout(
      () => setTick((now) => now + 1),
      Math.max(0, usedAt + COMPANION_RECENT_MS - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [on, front, usedAt]);
  return front && Date.now() - usedAt < COMPANION_RECENT_MS;
}

/**
 * The page's title as its tab says it, without what follows it – the workspace, the app
 * („Angebot | Mein Workspace | Cloud“ → „Angebot“) – and the count of the unread before it
 * („(3) Sender“).
 */
const pageTitle = () => {
  const title = document.title.replace(/^\(\d+\)\s*/, '');
  return title.split(' | ')[0]?.trim() || title;
};

/**
 * Every signed-in tab tells the server what it is (phone or desk), whether one works at it and –
 * a desk – what its page is about, on every change and after every reconnect of its stream
 * (`POST /calls/companion`). A desk's page: from its address, its title and its lines for the
 * agent (`useCallHere`).
 */
export function useReportView(phone: boolean) {
  const calls = useCallsOrNull();
  const peerId = calls?.snap.peerId ?? null;
  const signedIn = !!calls?.snap.me;
  const { opened } = useCompanionHeard();
  const location = useLocation();
  const workspace = useActiveWorkspace();
  const inUse = useInUse(!phone && signedIn);
  const [lines, setLines] = useState(ownCallHere);
  const [title, setTitle] = useState(() => (typeof document === 'undefined' ? '' : pageTitle()));

  useEffect(() => onCallHere(() => setLines(ownCallHere())), []);
  // The title is set by the page after its data came: watched, not read once.
  useEffect(() => {
    const read = () => setTitle(pageTitle());
    read();
    const head = document.querySelector('head');
    if (!head) return;
    const watcher = new MutationObserver(read);
    watcher.observe(head, { subtree: true, childList: true, characterData: true });
    return () => watcher.disconnect();
  }, []);

  const view: CompanionView | null = phone
    ? null
    : viewOf(location.pathname, location.search, title, lines, workspace?.id ?? null);
  const report: CompanionReport | null = peerId
    ? { peerId, device: phone ? 'phone' : 'desk', active: phone ? false : inUse, view }
    : null;
  const key = report && JSON.stringify(report);
  const told = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn || !report || !key) return;
    const again = `${opened}:${key}`;
    if (told.current === again) return;
    const timer = window.setTimeout(() => {
      told.current = again;
      // Lost (offline, a restart): the next change or reconnect says it again.
      void api.post('/calls/companion', report).catch(() => undefined);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
    // `report` is the same as `key` says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opened, signedIn]);
}
