import { z } from 'zod';
import { callPeerIdSchema, MAX_CALL_HERE } from './calls';

/**
 * The phone beside the computer („Begleiter“): while one works on the computer, the phone shows
 * what goes with the page there – the panel beside a mail, a chat, an event, a file, the slide's
 * comments, a document's comments, else today – and talks with the workspace's AI about it.
 *
 * Per account (Einstellungen › „Handy als Begleiter“):
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
  /** A conversation: `id` the channel; `null` with `sub` an area – its own channel (the first). */
  'chat',
  /** The calendar: `sub` the day (YYYY-MM-DD), `id` the event open beside it, if one is. */
  'calendar',
  /**
   * Cloud: `id` the file (or folder) whose details are open – a page or a diagram open is its file
   * too; `null` a folder's files.
   */
  'file',
  /** A presentation: `id` the deck, `sub` the slide on screen. */
  'deck',
  /** A text document (Writer): `id` the document. */
  'document',
  /** A PDF (Reader): `id` the PDF. */
  'pdf',
  /** A to-do open beside a page of Cloud: `id` the to-do. */
  'todo',
  /** Anything else: today's to-dos and events, and the AI. */
  'page',
] as const;
export const companionKindSchema = z.enum(COMPANION_KINDS);
export type CompanionKind = z.infer<typeof companionKindSchema>;

/** Slides a show's report names at most – a longer deck's phone goes by the slides it loaded. */
export const MAX_COMPANION_SLIDE_IDS = 1000;

const idSchema = z.string().min(1).max(200).nullable();

/**
 * A slide show running on the computer (presenter view, the show, the audience's window): where
 * it is – the phone shows the notes, the next slide, the time and steps it on.
 */
export const companionShowSchema = z.object({
  deckId: z.string().min(1).max(200),
  /** The slide shown; `null` with `ended`: the black end screen. */
  slideId: idSchema,
  ended: z.boolean(),
  black: z.boolean(),
  /** When the show began (ISO) – the phone's stopwatch. */
  startedAt: z.iso.datetime(),
  /**
   * The slides the show steps through, as the computer fixed them when it began (a slide hidden or
   * added meanwhile does not change them) – the phone's next slide and notes follow these.
   */
  slideIds: z.array(z.string().min(1).max(200)).max(MAX_COMPANION_SLIDE_IDS).optional(),
});
export type CompanionShow = z.infer<typeof companionShowSchema>;

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
  /** A slide show running there. */
  show: companionShowSchema.nullable().optional(),
});
export type CompanionView = z.infer<typeof companionViewSchema>;

/** An address of the app itself: one `/` (never `//`, a host), no scheme. */
export const companionPathSchema = z
  .string()
  .min(1)
  .max(1000)
  .regex(/^\/(?![/\\])/);

/**
 * What the phone asks the computer to do (`POST /calls/companion/command`) – steps of a slide
 * show and opening a page, nothing else: nothing that changes or deletes. The server hands it to
 * the one computer tab the phone shows, of the same person.
 */
export const companionCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('show'),
    deckId: z.string().min(1).max(200),
    action: z.enum(['next', 'prev', 'black']),
    /** The slide the phone saw when pressed: a computer elsewhere already ignores it. */
    from: idSchema,
  }),
  /** „Am Computer öffnen“. */
  z.object({ type: z.literal('open'), path: companionPathSchema }),
]);
export type CompanionCommand = z.infer<typeof companionCommandSchema>;

/** The SSE event the one computer tab hears a command on (`/calls/live`). */
export const COMPANION_COMMAND_SSE_EVENT = 'companion-command';

/** `POST /calls/companion`: a tab says what it is and what it shows – on every change. */
export const companionReportSchema = z.object({
  peerId: callPeerIdSchema,
  /** A phone (small touch screen) shows; anything else works and is shown. */
  device: z.enum(['phone', 'desk']),
  /** The tab is the one in front (visible and focused). */
  active: z.boolean(),
  /**
   * A slide show or a call runs in the tab: a page asked from the phone does not open there
   * (refused, the phone says so) – a show's own steps still go.
   */
  busy: z.boolean().optional(),
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
/**
 * A computer tab in use or presenting says so again this often (its report unchanged): a tab that
 * stops saying it – gone without its stream noticing (a lid closed, a proxy holding on) – soon
 * counts as in use no more and gives way to the one really worked at.
 */
export const COMPANION_REFRESH_MS = 60_000;
/** A computer left alone this long is gone for the phone (the companion closes). */
export const COMPANION_GONE_MS = 60 * 60_000;
