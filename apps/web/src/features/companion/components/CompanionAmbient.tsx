import { useEffect, useState } from 'react';

/*
 * The phone on its stand, left alone: after a while untouched (and nothing new on the computer)
 * the companion rests – near black, the time large, one line of what the computer shows. A web
 * page cannot dim the screen; this is as dark as it can be, keeps what is on the computer from
 * whoever passes, and moves a few pixels now and then so nothing burns into the screen. A tap, or
 * a new page on the computer, wakes it. Never while a slide show runs.
 */

/** Where the clock stands, in turn – a step every few minutes (px). */
const SHIFTS = [
  [0, 0],
  [6, -4],
  [-5, 5],
  [4, 6],
  [-6, -5],
  [2, -7],
] as const;
const SHIFT_EVERY_MS = 3 * 60_000;

const clockFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** The time, every few seconds (the minute changes on time). */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function CompanionAmbient({
  line,
  active,
  onWake,
}: {
  /** What the computer shows, in a word or two. */
  line: string;
  /** The computer is in use right now. */
  active: boolean;
  onWake: () => void;
}) {
  const now = useClock();
  const [x, y] = SHIFTS[Math.floor(now / SHIFT_EVERY_MS) % SHIFTS.length] ?? SHIFTS[0];
  return (
    <button
      type="button"
      aria-label="Begleiter wecken"
      data-companion-ambient
      // Woken on the click, not the touch: gone at once, the touch's click would land on what lies
      // below (✕, a card). Held down here, nothing below is focused either.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onWake}
      className="fixed inset-0 z-(--z-presentation) flex cursor-default flex-col items-center justify-center bg-black outline-none"
    >
      <span
        className="flex flex-col items-center gap-3 transition-transform duration-1000"
        style={{ transform: `translate(${x}px, ${y}px)` }}
      >
        <span className="text-[72px] leading-none font-light text-white/60 tabular-nums">
          {clockFormat.format(now)}
        </span>
        <span className="flex items-center gap-2 text-body text-white/40">
          {active && <span aria-hidden className="size-2 rounded-full bg-success opacity-60" />}
          {line}
        </span>
      </span>
    </button>
  );
}
