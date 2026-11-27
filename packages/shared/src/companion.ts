import { z } from 'zod';
import { callPeerIdSchema, MAX_CALL_HERE } from './calls';

/**
 * The phone beside the computer („Begleiter“): while one works on the computer, the phone shows
 * what goes with the page there – the panel beside a mail, a chat, an event, a file, the slide's
 * comments, a document's comments, else today – and talks with the workspace's AI about it.
 *
 * Per account (Einstellungen › Darstellung › „Handy als Begleiter“):
 * - `auto`: the phone turns into the companion by itself once the computer is in use,
 * - `ask`: a sign beside the date in the phone's header offers it – one tap,
 * - `never`: neither.
 */
export const COMPANION_MODES = ['auto', 'ask', 'never'] as const;
export const companionModeSchema = z.enum(COMPANION_MODES);
export type CompanionMode = z.infer<typeof companionModeSchema>;
export const DEFAULT_COMPANION_MODE: CompanionMode = 'auto';

/** What the computer's page is about – the phone shows the panel that goes with it. */
export const COMPANION_KINDS = [
  /** A mail: `id` the thread. */
  'mail',
  /** A conversation in Sender: `id` the channel. */
  'chat',
  /** The calendar: `sub` the day (YYYY-MM-DD), `id` the event open beside it, if one is. */
  'calendar',
  /** Cloud: `id` the file (or folder) whose details are open; `null` a folder's files. */
  'file',
  /** A presentation: `id` the deck, `sub` the slide on screen. */
  'deck',
  /** A text document (Writer): `id` the document. */
  'document',
  /** A PDF (Reader): `id` the PDF. */
  'pdf',
  /** Anything else: today's to-dos and events, and the AI. */
  'page',
] as const;
export const companionKindSchema = z.enum(COMPANION_KINDS);
export type CompanionKind = z.infer<typeof companionKindSchema>;

const idSchema = z.string().min(1).max(200).nullable();

export const companionViewSchema = z.object({
  kind: companionKindSchema,
  workspaceId: idSchema,
  id: idSchema,
  sub: idSchema,
  /** The page's title as its tab says it („Angebot Müller“), for the phone's top line. */
  title: z.string().max(200),
  /** Where the computer is (path and search) – „Hier öffnen“ on the phone goes there. */
  path: z.string().max(1000),
  /**
   * What the computer's page says it has in front of one (`useCallHere`'s lines) – the phone's
   * AI is asked with it, as if one asked on the computer.
   */
  here: z.string().max(MAX_CALL_HERE),
});
export type CompanionView = z.infer<typeof companionViewSchema>;

/** `POST /calls/companion`: a tab says what it is and what it shows – on every change. */
export const companionReportSchema = z.object({
  peerId: callPeerIdSchema,
  /** A phone (small touch screen) shows; anything else works and is shown. */
  device: z.enum(['phone', 'desk']),
  /** The tab is the one in front (visible and focused). */
  active: z.boolean(),
  /** What the page is about – desks only; `null` on a phone. */
  view: companionViewSchema.nullable(),
});
export type CompanionReport = z.infer<typeof companionReportSchema>;

/**
 * What a phone hears (SSE event `companion` on `/calls/live`): the computer last worked at –
 * its view, whether it is in front now, and since when nothing happened there. `null`: no
 * computer of one's own is open.
 */
export interface CompanionDesk {
  view: CompanionView;
  /** The computer's tab is in front right now. */
  active: boolean;
  /** When that tab was last in front or changed its page (ISO). */
  at: string;
}

/** The SSE event's name on `/calls/live`. */
export const COMPANION_SSE_EVENT = 'companion';

export interface CompanionEvent {
  desk: CompanionDesk | null;
}

/** The computer counts as in use this long after its tab was last in front or changed. */
export const COMPANION_RECENT_MS = 2 * 60_000;
/** A computer left alone this long is gone for the phone (the companion closes). */
export const COMPANION_GONE_MS = 60 * 60_000;
