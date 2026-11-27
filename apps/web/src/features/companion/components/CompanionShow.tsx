import type { CompanionCommand, CompanionShow } from '@slider/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeckNotes, useSlides } from '@/lib/api';
import { useCallHere } from '@/lib/call-here';
import { readJson, writeJson } from '@/lib/storage';
import { SlideThumbnail } from '@/features/reviews';
import { formatElapsed, notesFromText, notesToHtml, showSlidesOf } from '@/features/viewer';
import { Button, cn, IconButton, type ShowToast } from '@/ui';
import { askDesk } from '../lib/command';

/*
 * A slide show running on the computer, stepped on from the phone beside it – as a presenter view
 * in the hand: the slide there and the next one, its notes (bigger or smaller), the time since the
 * show began and the clock, and „Weiter“ big under the thumb. What the computer shows is the truth:
 * a step shows at once and goes back if the computer did not take it.
 */

/** The notes' type sizes (px), A− and A+ step through them – kept in this browser. */
const NOTE_SIZES = [16, 18, 20, 24, 28, 32] as const;
const NOTE_SIZE_KEY = 'slider.companion.notesSize';
/** A step not seen on the computer by then is forgotten (lost, or the computer refused it). */
const PENDING_MS = 2_500;
/** A swipe this far (px) across the slide steps. */
const SWIPE_PX = 48;

const clockFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** The time now, a second at a time. */
function useSecond() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function ShowBody({ show, notify }: { show: CompanionShow; notify: ShowToast }) {
  const loaded = useSlides(show.deckId);
  const slides = useMemo(() => showSlidesOf(loaded.data ?? []), [loaded.data]);
  const notes = useDeckNotes(show.deckId);
  const now = useSecond();
  const [size, setSize] = useState(() =>
    readJson(
      NOTE_SIZE_KEY,
      (value) => (NOTE_SIZES.includes(value as never) ? (value as number) : NOTE_SIZES[2]),
      NOTE_SIZES[2],
    ),
  );
  const resize = (by: 1 | -1) => {
    const at = NOTE_SIZES.indexOf(size as (typeof NOTE_SIZES)[number]);
    const next = NOTE_SIZES[Math.min(NOTE_SIZES.length - 1, Math.max(0, at + by))] ?? size;
    setSize(next);
    writeJson(NOTE_SIZE_KEY, next);
  };

  // Where the computer is; a step pressed here shows at once, until the computer says otherwise
  // (a step pressed on a slide the computer has left counts no more).
  const shownAt = show.ended
    ? slides.length
    : Math.max(
        0,
        slides.findIndex((slide) => slide.id === show.slideId),
      );
  const [pending, setPending] = useState<{ from: string; to: number } | null>(null);
  const key = `${show.slideId ?? 'end'}:${show.black}`;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(null), PENDING_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const index = pending && pending.from === key ? pending.to : shownAt;
  const ended = index >= slides.length;
  const current = ended ? null : (slides[index] ?? null);
  const next = slides[index + 1] ?? null;
  const own = current && notes.data?.slides.find((each) => each.slideId === current.id);
  const paragraphs = own ? (own.notesRich ?? notesFromText(own.notes)) : [];
  const html = paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim()))
    ? notesToHtml(paragraphs)
    : null;

  useCallHere(
    'companion-show',
    current ? `Präsentiert gerade Folie ${index + 1} von ${slides.length}` : null,
  );

  const ask = (action: Extract<CompanionCommand, { type: 'show' }>['action']) => {
    if (action !== 'black' && !show.black) {
      const to = Math.min(slides.length, Math.max(0, index + (action === 'next' ? 1 : -1)));
      if (to !== index) setPending({ from: key, to });
    }
    navigator.vibrate?.(10);
    void askDesk(
      { type: 'show', deckId: show.deckId, action, from: show.ended ? null : show.slideId },
      notify,
    ).then((taken) => {
      if (!taken) setPending(null);
    });
  };

  const touch = useRef<{ x: number; y: number } | null>(null);
  if (loaded.isPending) return null;
  return (
    <div className="flex min-h-full flex-col gap-4 px-4 pt-4">
      <div className="flex items-center justify-between text-caption text-fg-muted tabular-nums">
        <span>{ended ? 'Ende' : `Folie ${index + 1} / ${slides.length}`}</span>
        <span className="text-body font-semibold text-fg">
          {formatElapsed(now - Date.parse(show.startedAt))}
        </span>
        <span>{clockFormat.format(now)}</span>
      </div>
      <div
        className="relative overflow-hidden rounded-panel border border-hairline bg-black"
        style={{ aspectRatio: current?.aspectRatio ?? 16 / 9 }}
        onTouchStart={(event) => {
          const point = event.touches[0];
          touch.current = point ? { x: point.clientX, y: point.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = touch.current;
          const point = event.changedTouches[0];
          touch.current = null;
          if (!start || !point) return;
          const dx = point.clientX - start.x;
          if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(point.clientY - start.y)) return;
          ask(dx < 0 ? 'next' : 'prev');
        }}
      >
        {current && !show.black && (
          <SlideThumbnail src={current.thumbnailUrl} className="size-full" />
        )}
        {(ended || show.black) && (
          <span className="absolute inset-0 flex items-center justify-center text-caption text-white/70">
            {ended ? 'Ende der Präsentation' : 'Schwarz'}
          </span>
        )}
      </div>
      <div className="flex items-start gap-3">
        <div className="w-28 shrink-0">
          {next ? (
            <SlideThumbnail src={next.thumbnailUrl} className="w-full" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-control bg-black text-caption text-white/70">
              Ende
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-caption text-fg-subtle">Als Nächstes</span>
          <span className="line-clamp-2 text-body text-fg">
            {next ? next.title || `Folie ${index + 2}` : 'Ende der Präsentation'}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-caption font-semibold tracking-wider text-fg-subtle uppercase">
            Notizen
          </h3>
          <div className="flex items-center gap-1">
            <IconButton
              icon="remove"
              label="Notizen kleiner"
              variant="ghost"
              disabled={size === NOTE_SIZES[0]}
              onClick={() => resize(-1)}
            />
            <IconButton
              icon="add"
              label="Notizen größer"
              variant="ghost"
              disabled={size === NOTE_SIZES.at(-1)}
              onClick={() => resize(1)}
            />
          </div>
        </div>
        {html ? (
          <div
            data-companion-notes
            className={cn(
              'leading-relaxed whitespace-pre-wrap text-fg',
              '[&_ol]:list-decimal [&_ol]:pl-7 [&_ul]:list-disc [&_ul]:pl-7 [&_ul_ul]:list-[circle]',
            )}
            style={{ fontSize: size }}
            // `notesToHtml` escapes the text; only its own tags are markup.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p className="text-caption text-fg-muted">Keine Notizen zu dieser Folie.</p>
        )}
      </div>
      {/* Under the thumb, staying while the notes scroll. */}
      <div className="sticky bottom-0 -mx-4 mt-auto flex items-center gap-2 border-t border-hairline bg-canvas px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Back and black small beside it, as on a presenter's remote; the same height. */}
        <IconButton
          icon="chevronLeft"
          label="Zurück"
          variant="glass"
          className="size-11"
          disabled={index === 0 && !show.black}
          onClick={() => ask('prev')}
        />
        <IconButton
          icon="darkMode"
          label="Schwarz"
          variant="glass"
          className="size-11"
          active={show.black}
          disabled={ended}
          onClick={() => ask('black')}
        />
        <Button
          variant="primary"
          size="lg"
          trailingIcon="chevronRight"
          className="flex-1"
          onClick={() => ask('next')}
        >
          {ended ? 'Beenden' : 'Weiter'}
        </Button>
      </div>
    </div>
  );
}
