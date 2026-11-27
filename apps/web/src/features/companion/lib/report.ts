import {
  COMPANION_RECENT_MS,
  COMPANION_REFRESH_MS,
  companionPathSchema,
  type CompanionReport,
  type CompanionView,
} from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { useCallsOrNull } from '@/features/calls';
import { diagramKeys, queryKeys, readerKeys, writerKeys } from '@/lib/api';
import { api } from '@/lib/api-client';
import { onCallHere, ownCallHere } from '@/lib/call-here';
import { onCompanionCommand, useCompanionHeard, useCompanionShow } from '@/lib/companion';
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
  // Opened counts as used; each use starts the time anew.
  const [usedAt, setUsedAt] = useState(() => Date.now());
  const [recent, setRecent] = useState(true);
  useEffect(() => {
    if (!on) return;
    let last = 0;
    const used = () => {
      const now = Date.now();
      if (now - last < INPUT_EVERY_MS) return;
      last = now;
      setUsedAt(now);
      setRecent(true);
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
    if (!on) return;
    const timer = window.setTimeout(
      () => setRecent(false),
      Math.max(0, usedAt + COMPANION_RECENT_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [on, usedAt]);
  return front && recent;
}

/**
 * The workspace of the presentation, document, PDF or diagram open – their addresses (`/d/`, `/t/`,
 * `/r/`, `/diagramm/`) name none: read from what the page loaded (no request of its own).
 */
function useOpenedWorkspace(pathname: string): string | null {
  const queryClient = useQueryClient();
  const deck = matchPath('/d/:id', pathname)?.params.id;
  const document = matchPath('/t/:id', pathname)?.params.id;
  const pdf = matchPath('/r/:id', pathname)?.params.id;
  const diagram = matchPath('/diagramm/:id', pathname)?.params.id;
  const read = (): string | null => {
    if (deck)
      return (
        queryClient.getQueryData<{ workspaceId: string }>(queryKeys.deck(deck))?.workspaceId ?? null
      );
    if (document)
      return (
        queryClient.getQueryData<{ document: { workspaceId: string } }>(
          writerKeys.document(document),
        )?.document.workspaceId ?? null
      );
    if (pdf)
      return (
        queryClient.getQueryData<{ pdf: { workspaceId: string } }>(readerKeys.pdf(pdf))?.pdf
          .workspaceId ?? null
      );
    if (diagram)
      return (
        queryClient.getQueryData<{ file: { workspaceId: string } }>(diagramKeys.diagram(diagram))
          ?.file.workspaceId ?? null
      );
    return null;
  };
  return useSyncExternalStore(
    (changed) => queryClient.getQueryCache().subscribe(changed),
    read,
    read,
  );
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
 * „Am Computer öffnen“ on the phone: the page it names opens in this tab (the computer tab the
 * phone shows – the server hands it to that one alone). Only the app's own addresses; not while a
 * slide show or a call runs here – that is not taken away from under one.
 */
function useOpenFromPhone(on: boolean, busy: boolean) {
  const navigate = useNavigate();
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    if (!on) return;
    return onCompanionCommand((command) => {
      if (command.type !== 'open' || busyRef.current) return;
      const path = companionPathSchema.safeParse(command.path);
      if (path.success) void navigate(path.data);
    });
  }, [on, navigate]);
}

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
  const openedWorkspace = useOpenedWorkspace(location.pathname);
  const inUse = useInUse(!phone && signedIn);
  const show = useCompanionShow();
  useOpenFromPhone(!phone && signedIn, !!show || !!calls?.snap.active);
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

  const page: CompanionView | null = phone
    ? null
    : viewOf(
        location.pathname,
        location.search,
        title,
        lines,
        openedWorkspace ?? workspace?.id ?? null,
      );
  // A slide show of the deck open here: where it is, for the phone's presenter view.
  const view =
    page && show && page.kind === 'deck' && page.id === show.deckId ? { ...page, show } : page;
  const report: CompanionReport | null = peerId
    ? { peerId, device: phone ? 'phone' : 'desk', active: phone ? false : inUse, view }
    : null;
  const key = report && JSON.stringify(report);
  const told = useRef<string | null>(null);
  const toldShow = useRef<string | null>(null);
  // In use or presenting: said again now and then – the server forgets it otherwise.
  const live = !!report && (report.active || !!view?.show);
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setBeat((count) => count + 1), COMPANION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [live]);

  useEffect(() => {
    if (!signedIn || !report || !key) return;
    const again = `${opened}:${live ? beat : ''}:${key}`;
    if (told.current === again) return;
    // A step of the show is told at once: the phone steps along with it.
    const shown = JSON.stringify(view?.show ?? null);
    const timer = window.setTimeout(
      () => {
        told.current = again;
        toldShow.current = shown;
        // Lost (offline, a restart): the next change or reconnect says it again.
        void api.post('/calls/companion', report).catch(() => undefined);
      },
      shown !== toldShow.current ? 0 : SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
    // `report` is the same as `key` says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opened, signedIn, live, beat]);
}
