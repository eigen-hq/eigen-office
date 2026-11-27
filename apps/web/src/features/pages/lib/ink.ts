import { ACCENT_COLORS, type AccentColor } from '@slider/shared';
import { getStroke, type StrokeOptions } from 'perfect-freehand';

/*
 * A drawing on a page – written and drawn by hand – kept in the Markdown file as a fenced block of
 * its own, one stroke a line, so a stroke drawn is one line more in the file (the page sends only
 * the lines that changed) and a stroke wiped one line less:
 *
 *   ```ink 400
 *   draw pen text 4 120 40 52 121 42 60 125 47 64
 *   more 126 49 60 128 52 41
 *   shape pen red 4 300 80 420 80 420 160 300 160 300 80
 *   text 1k3f9a Einkaufen / Milch
 *   ```
 *
 * The block is INK_WIDTH units wide at any width it is shown; the number after `ink` is its height
 * in the same units. A stroke: `draw`, its tool, its colour (`text` – the page's text colour – or an
 * accent), its width and its points as whole numbers, each `x y force` (force 1–100 as the pen
 * pressed; 0 where nothing measured it – a mouse – and the line is thinned by its speed). Longer
 * than a line holds, it goes on in `more` lines of points. `shape`: a form drawn true (a line, a
 * box, a circle), its corners as `x y`. `text`: what the handwriting says, read on the device, for the
 * search and the AI (with a mark of the strokes it read). Lines of 1.6.18 – `pen …`/`marker …`,
 * points as `x y` – are read as they are. A line the page does not read is kept as it stands.
 */

export const INK_WIDTH = 1000;
export const INK_HEIGHT = 360;
/** Drawn near its foot, the block grows by this much (no fixed sheet to write off). */
export const INK_GROW = 240;
export const INK_MAX_HEIGHT = 20_000;
/** A line of the file holds 20 000 characters: a longer stroke goes on in a `more` line. */
const MAX_LINE = 18_000;

export type InkTool = 'pen' | 'marker';
export type InkColor = 'text' | AccentColor;
/** A point: where, and how hard the pen pressed (0–1; absent where nothing measured it). */
export type InkPoint = readonly [x: number, y: number, force?: number];

export interface InkStroke {
  tool: InkTool;
  color: InkColor;
  width: number;
  points: InkPoint[];
  /** Drawn true (a recognised form): its points are corners, joined straight. */
  exact?: boolean;
}

export interface InkEntry {
  /** Its lines in the block (0: the fence) – one, or a `draw` and its `more` lines. */
  lines: number[];
  stroke: InkStroke;
  /** Its lines as written: what its outline is kept by. */
  key: string;
}

export interface Ink {
  height: number;
  strokes: InkEntry[];
  /** What the handwriting says, and the mark of the strokes it was read from. */
  transcript: { line: number; mark: string; text: string } | null;
}

/** The fence's first line: ```ink, its height after it. */
const OPEN = /^\s{0,3}(`{3,}|~{3,})\s*ink(?:\s+(\d+))?\s*$/i;
const COLORS = new Set<string>(['text', ...ACCENT_COLORS]);

/** Whether the block's lines are a drawing: ```ink, closed. */
export function isInkFence(lines: readonly string[]): boolean {
  const open = OPEN.exec(lines[0] ?? '');
  if (!open || lines.length < 2) return false;
  const close = lines.at(-1)!.trim();
  return close.startsWith(open[1]!) && /^[`~]+$/.test(close);
}

const numbersOf = (words: readonly string[]): number[] | null => {
  const numbers = words.map(Number);
  return numbers.some((value) => !Number.isFinite(value)) ? null : numbers;
};

/** Points of `x y` or `x y force` words. */
function pointsOf(words: readonly string[], forced: boolean): InkPoint[] | null {
  const step = forced ? 3 : 2;
  if (words.length < step || words.length % step !== 0) return null;
  const numbers = numbersOf(words);
  if (!numbers) return null;
  const points: InkPoint[] = [];
  for (let at = 0; at < numbers.length; at += step) {
    const force = forced ? numbers[at + 2]! : 0;
    points.push(
      force > 0
        ? [numbers[at]!, numbers[at + 1]!, Math.min(force, 100) / 100]
        : [numbers[at]!, numbers[at + 1]!],
    );
  }
  return points;
}

/** The head of a stroke's line: tool, colour, width – or `null`. */
function headOf(tool?: string, color?: string, width?: string) {
  if ((tool !== 'pen' && tool !== 'marker') || !color || !COLORS.has(color)) return null;
  const size = Number(width);
  if (!Number.isFinite(size) || size <= 0) return null;
  return { tool: tool as InkTool, color: color as InkColor, width: size };
}

/** A line that starts a stroke (`draw`, `shape`, or 1.6.18's `pen`/`marker`) – or `null`. */
export function parseStroke(line: string): InkStroke | null {
  const words = line.trim().split(/\s+/);
  const kind = words[0];
  if (kind === 'draw' || kind === 'shape') {
    const head = headOf(words[1], words[2], words[3]);
    const points = head && pointsOf(words.slice(4), kind === 'draw');
    if (!head || !points) return null;
    return kind === 'shape' ? { ...head, points, exact: true } : { ...head, points };
  }
  const head = headOf(kind, words[1], words[2]);
  const points = head && pointsOf(words.slice(3), false);
  return head && points ? { ...head, points } : null;
}

export function parseInk(text: string): Ink {
  const lines = text.split('\n');
  const height = Number(OPEN.exec(lines[0] ?? '')?.[2]);
  const strokes: InkEntry[] = [];
  let transcript: Ink['transcript'] = null;
  let open: InkEntry | null = null;
  const end = isInkFence(lines) ? lines.length - 1 : lines.length;
  for (let index = 1; index < end; index += 1) {
    const line = lines[index]!;
    const words = line.trim().split(/\s+/);
    if (words[0] === 'more') {
      // A `more` goes on with the `draw` right above it; alone it is kept as it stands.
      const more = open && !open.stroke.exact ? pointsOf(words.slice(1), true) : null;
      if (open && more) {
        open.stroke.points.push(...more);
        open.lines.push(index);
        open.key += `\n${line}`;
      } else open = null;
      continue;
    }
    if (words[0] === 'text' && words.length >= 2) {
      transcript = { line: index, mark: words[1]!, text: words.slice(2).join(' ') };
      open = null;
      continue;
    }
    const stroke = parseStroke(line);
    open = stroke ? { lines: [index], stroke, key: line } : null;
    if (open) strokes.push(open);
  }
  return {
    height: Number.isFinite(height) && height > 0 ? Math.min(height, INK_MAX_HEIGHT) : INK_HEIGHT,
    strokes,
    transcript,
  };
}

const round = (value: number) => Math.round(value);
const forceOf = (point: InkPoint) =>
  point[2] === undefined ? 0 : Math.max(1, Math.min(100, Math.round(point[2] * 100)));

/** A stroke as its lines – a `draw` and `more` lines when it is longer than a line holds. */
export function strokeLines(stroke: InkStroke): string[] {
  const head = `${stroke.exact ? 'shape' : 'draw'} ${stroke.tool} ${stroke.color} ${round(stroke.width)}`;
  const lines: string[] = [];
  let line = head;
  for (const point of stroke.points) {
    const word = stroke.exact
      ? ` ${round(point[0])} ${round(point[1])}`
      : ` ${round(point[0])} ${round(point[1])} ${forceOf(point)}`;
    if (line.length + word.length > MAX_LINE && !stroke.exact) {
      lines.push(line);
      line = 'more';
    }
    line += word;
  }
  lines.push(line);
  return lines;
}

/** An empty drawing, as a new one is written. */
export const newInk = (height = INK_HEIGHT) => `\`\`\`ink ${height}\n\`\`\``;

/** Where strokes go in: before the closing fence (or at the end, unclosed). */
const endOf = (lines: readonly string[]) => (isInkFence(lines) ? lines.length - 1 : lines.length);

/** The block with these strokes drawn: before its text line and its closing fence. */
export function addStrokes(text: string, strokes: readonly InkStroke[]): string {
  const lines = text.split('\n');
  const transcript = parseInk(text).transcript;
  const at = transcript ? transcript.line : endOf(lines);
  lines.splice(at, 0, ...strokes.flatMap(strokeLines));
  return lines.join('\n');
}

/** The block without these lines (as `parseInk` numbered them). */
export function removeLines(text: string, gone: ReadonlySet<number>): string {
  return text
    .split('\n')
    .filter((_, index) => !gone.has(index))
    .join('\n');
}

/**
 * The block with strokes changed where they stand (their place is their order on the sheet):
 * each stroke named – by its index in `parseInk` – by what takes its place, none to wipe it.
 */
export function replaceStrokes(text: string, changes: ReadonlyMap<number, readonly InkStroke[]>) {
  const lines = text.split('\n');
  const { strokes } = parseInk(text);
  const first = new Map<number, readonly InkStroke[]>();
  const gone = new Set<number>();
  for (const [index, next] of changes) {
    const entry = strokes[index];
    if (!entry) continue;
    first.set(entry.lines[0]!, next);
    for (const line of entry.lines) gone.add(line);
  }
  return lines
    .flatMap((line, index) => {
      const next = first.get(index);
      if (next) return next.flatMap(strokeLines);
      return gone.has(index) ? [] : [line];
    })
    .join('\n');
}

/** The block with room above its strokes: every one moved down `dy`, the block that much taller. */
export function liftInk(text: string, dy: number): string {
  const ink = parseInk(text);
  const moved = new Map(
    ink.strokes.map(({ stroke }, index) => [index, [moveStroke(stroke, 0, dy)]]),
  );
  return setHeight(replaceStrokes(text, moved), ink.height + dy);
}

/** The block at this height: its first line written anew, the rest as it stands. */
export function setHeight(text: string, height: number): string {
  const lines = text.split('\n');
  const open = OPEN.exec(lines[0] ?? '');
  const fence = open?.[1] ?? '```';
  lines[0] = `${fence}ink ${round(Math.min(Math.max(height, 80), INK_MAX_HEIGHT))}`;
  return lines.join('\n');
}

// ── What the handwriting says ───────────────────────────────────────────

/** A mark of the strokes as they are: the text read from them is kept by it. */
export function strokesMark(ink: Ink): string {
  let hash = 5381;
  for (const { key } of ink.strokes) {
    for (let at = 0; at < key.length; at += 1) hash = ((hash << 5) + hash + key.charCodeAt(at)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * The block with what its handwriting says (one line, before the fence) – kept with the strokes'
 * mark even when it says nothing (a sketch is not read again); no mark: the line gone.
 */
export function setTranscript(text: string, mark: string, said: string): string {
  const lines = text.split('\n');
  const { transcript } = parseInk(text);
  const clean = said
    .replace(/\s*\n\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
  if (transcript) lines.splice(transcript.line, 1);
  if (mark) lines.splice(endOf(lines), 0, clean ? `text ${mark} ${clean}` : `text ${mark}`);
  return lines.join('\n');
}

// ── Touching, drawing ───────────────────────────────────────────────────

/** Whether the point lies within `radius` of the stroke's line (the eraser's touch). */
export function touches(stroke: InkStroke, [x, y]: InkPoint, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  const { points } = stroke;
  if (points.length === 1) return Math.hypot(points[0]![0] - x, points[0]![1] - y) <= reach;
  for (let at = 1; at < points.length; at += 1) {
    const [ax, ay] = points[at - 1]!;
    const [bx, by] = points[at]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= reach) return true;
  }
  return false;
}

/**
 * The stroke without what lies within `radius` of the point – the precise eraser: none left,
 * the stroke itself (untouched), or the pieces on either side of the wiped part.
 */
export function wipePoints(stroke: InkStroke, point: InkPoint, radius: number): InkStroke[] {
  if (!touches(stroke, point, radius)) return [stroke];
  const reach = radius + stroke.width / 2;
  const pieces: InkPoint[][] = [];
  let piece: InkPoint[] = [];
  // Corners of a form are far apart: walked in small steps, so a wipe takes only what it touched.
  const points = stroke.exact ? densify(stroke.points, 4) : stroke.points;
  for (const each of points) {
    if (Math.hypot(each[0] - point[0], each[1] - point[1]) <= reach) {
      if (piece.length > 0) pieces.push(piece);
      piece = [];
    } else piece.push(each);
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces.map((part) => ({ ...stroke, points: part }));
}

/** The points with more between them, none further apart than `step`. */
export function densify(points: readonly InkPoint[], step: number): InkPoint[] {
  const out: InkPoint[] = [];
  points.forEach((point, at) => {
    const last = points[at - 1];
    if (last) {
      const parts = Math.floor(Math.hypot(point[0] - last[0], point[1] - last[1]) / step);
      for (let n = 1; n < parts; n += 1) {
        const t = n / parts;
        out.push([last[0] + (point[0] - last[0]) * t, last[1] + (point[1] - last[1]) * t]);
      }
    }
    out.push(point);
  });
  return out;
}

/** The box the strokes take: `[left, top, right, bottom]`, their widths in. */
export function boundsOf(strokes: readonly InkStroke[]): [number, number, number, number] | null {
  let box: [number, number, number, number] | null = null;
  for (const stroke of strokes) {
    const half = stroke.width / 2;
    for (const [x, y] of stroke.points) {
      box = box
        ? [
            Math.min(box[0], x - half),
            Math.min(box[1], y - half),
            Math.max(box[2], x + half),
            Math.max(box[3], y + half),
          ]
        : [x - half, y - half, x + half, y + half];
    }
  }
  return box;
}

export const moveStroke = (stroke: InkStroke, dx: number, dy: number): InkStroke => ({
  ...stroke,
  points: stroke.points.map(([x, y, force]) =>
    force === undefined ? ([x + dx, y + dy] as const) : ([x + dx, y + dy, force] as const),
  ),
});

/** Whether the point lies inside the closed loop (the lasso). */
export function inside([x, y]: InkPoint, loop: readonly InkPoint[]): boolean {
  let within = false;
  for (let at = 0, before = loop.length - 1; at < loop.length; before = at, at += 1) {
    const [ax, ay] = loop[at]!;
    const [bx, by] = loop[before]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) within = !within;
  }
  return within;
}

/** Whether the lasso holds the stroke: most of its points inside the loop. */
export function lassoHolds(stroke: InkStroke, loop: readonly InkPoint[]): boolean {
  const points = stroke.exact ? densify(stroke.points, 8) : stroke.points;
  const held = points.filter((point) => inside(point, loop)).length;
  return held > 0 && held >= points.length * 0.6;
}

/**
 * How a stroke is drawn: an outline filled (perfect-freehand – thinner and thicker as the pen
 * pressed, or as fast as it moved where nothing measured the press), a form as a line.
 */
export interface InkShape {
  d: string;
  /** Drawn as a line of the stroke's width (a form); else the outline is filled. */
  line: boolean;
}

const PEN: StrokeOptions = {
  thinning: 0.62,
  smoothing: 0.62,
  streamline: 0.32,
  easing: (t) => Math.sin((t * Math.PI) / 2),
  start: { cap: true, taper: 0 },
  end: { cap: true, taper: 0 },
};
const MARKER: StrokeOptions = {
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.4,
  start: { cap: true },
  end: { cap: true },
};

const average = (a: number, b: number) => (a + b) / 2;

/** The outline's points as a closed, smooth path (perfect-freehand's own recipe). */
function outlinePath(points: readonly number[][]): string {
  const count = points.length;
  if (count < 4) return '';
  let a = points[0]!;
  let b = points[1]!;
  const c = points[2]!;
  const n = (value: number) => value.toFixed(1);
  let d = `M${n(a[0]!)},${n(a[1]!)} Q${n(b[0]!)},${n(b[1]!)} ${n(average(b[0]!, c[0]!))},${n(average(b[1]!, c[1]!))} T`;
  for (let at = 2; at < count - 1; at += 1) {
    a = points[at]!;
    b = points[at + 1]!;
    d += `${n(average(a[0]!, b[0]!))},${n(average(a[1]!, b[1]!))} `;
  }
  return `${d}Z`;
}

/** A form's corners as a line. */
function cornersPath(points: readonly InkPoint[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  if (rest.length === 0) return `M${first[0]} ${first[1]}h0.01`;
  return `M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join('')}`;
}

/** The stroke as it is drawn; `last: false` while the pen is still on it. */
export function inkShape(stroke: InkStroke, last = true): InkShape {
  if (stroke.exact) return { d: cornersPath(stroke.points), line: true };
  const pressed = stroke.points.some((point) => point[2] !== undefined);
  const options: StrokeOptions = {
    ...(stroke.tool === 'marker' ? MARKER : PEN),
    size: stroke.width,
    simulatePressure: !pressed,
    last,
  };
  const outline = getStroke(
    stroke.points.map(([x, y, force]) => [x, y, force ?? 0.5]),
    options,
  );
  return { d: outlinePath(outline), line: false };
}

/** Outlines by their lines as written: a page of handwriting is drawn once, not on every stroke. */
const kept = new Map<string, InkShape>();
export function keptShape(entry: InkEntry): InkShape {
  const known = kept.get(entry.key);
  if (known) return known;
  if (kept.size > 6000) kept.clear();
  const shape = inkShape(entry.stroke);
  kept.set(entry.key, shape);
  return shape;
}
