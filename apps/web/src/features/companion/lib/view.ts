import type { CompanionView } from '@slider/shared';
import { matchPath } from 'react-router';
import { CLOUD_DAY_PARAM, CLOUD_EVENT_PARAM, CLOUD_FILE_PARAM } from '@/lib/routes';

/** `/w/:workspaceId/…` – the workspace a page lies in, where its address says it. */
const workspaceOf = (pathname: string): string | null =>
  matchPath('/w/:workspaceId/*', pathname)?.params.workspaceId ?? null;

const first = (pathname: string, patterns: readonly string[], param: string): string | null => {
  for (const pattern of patterns) {
    const value = matchPath(pattern, pathname)?.params[param];
    if (value) return value;
  }
  return null;
};

const MAIL = ['/w/:w/dateien/mail/:id', '/w/:w/nachrichten/mail/:id'];
/** Not a mail: the mailboxes' pages beside them. */
const MAIL_PAGES = new Set(['postfaecher']);
const CHAT = [
  '/w/:w/nachrichten/kanal/:id/*',
  '/w/:w/dateien/chat/:id/*',
  '/w/:w/dateien/bereich/:area/chat/:id/*',
];
const CALENDAR = ['/w/:w/dateien/kalender'];

/**
 * What a computer's page is about, from its address – the phone beside it shows what goes with
 * it: a mail, a conversation, the calendar (its day, an event), a file open in Cloud, a
 * presentation (its slide), a document, a PDF, else the page itself (today, and the AI).
 * `fallbackWorkspace`: the workspace one is in where the address does not say it (`/d/…`).
 */
export function viewOf(
  pathname: string,
  search: string,
  title: string,
  here: string,
  fallbackWorkspace: string | null = null,
): CompanionView {
  const query = new URLSearchParams(search);
  const workspaceId = workspaceOf(pathname) ?? fallbackWorkspace;
  const base = {
    workspaceId,
    id: null,
    sub: null,
    title: title.slice(0, 200),
    path: `${pathname}${search}`.slice(0, 1000),
    here,
  };
  const mail = first(pathname, MAIL, 'id');
  if (mail && !MAIL_PAGES.has(mail)) return { ...base, kind: 'mail', id: mail };
  const chat = first(pathname, CHAT, 'id');
  if (chat) return { ...base, kind: 'chat', id: chat };
  if (CALENDAR.some((pattern) => matchPath(pattern, pathname))) {
    const event = query.get(CLOUD_EVENT_PARAM);
    // `neu`: an event being made; `tag`: a day's agenda (its day in `am`).
    const agenda = event === 'tag';
    return {
      ...base,
      kind: 'calendar',
      id: event && event !== 'neu' && !agenda ? event : null,
      sub: (agenda && query.get('am')) || query.get(CLOUD_DAY_PARAM),
    };
  }
  const file = query.get(CLOUD_FILE_PARAM);
  if (file && matchPath('/w/:w/dateien/*', pathname)) return { ...base, kind: 'file', id: file };
  const deck = matchPath('/d/:id', pathname)?.params.id;
  if (deck) return { ...base, kind: 'deck', id: deck, sub: query.get('slide') };
  const document = matchPath('/t/:id', pathname)?.params.id;
  if (document) return { ...base, kind: 'document', id: document };
  const pdf = matchPath('/r/:id', pathname)?.params.id;
  if (pdf) return { ...base, kind: 'pdf', id: pdf };
  return { ...base, kind: 'page' };
}
