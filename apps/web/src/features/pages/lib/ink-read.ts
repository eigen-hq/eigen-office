import type { LexicalEditor, NodeKey } from 'lexical';
import { boundsOf, INK_WIDTH, keptShape, type InkEntry } from './ink';

/*
 * What a drawing says (`components/InkReader.tsx`): its pictures for the AI, and its reading asked
 * at once.
 */

/** The update that writes what was read: sent like typing, in Lesen too (`PageEditor`). */
export const INK_READ_TAG = 'ink-read';
/** The picture's width at most (px): a page's line of writing stays a few dozen pixels high. */
const PICTURE_WIDTH = 1400;
/** A tall drawing goes in bands about this tall (units) – each a picture the AI reads at full size. */
const BAND = 1000;
/** The most bands sent (as the server takes): taller, each band is taller. */
const MAX_BANDS = 8;
/** Bands end between lines of writing; where none is, they overlap this much (units). */
const OVERLAP = 120;
const PAD = 24;
type Box = readonly [left: number, top: number, right: number, bottom: number];

/** Where a band from `from` ends: the lowest gap between strokes in its last part, else its end. */
function bandEnd(boxes: readonly Box[], from: number, band: number): number {
  const end = from + band;
  const crossed = (y: number) => boxes.some((box) => box[1] < y && box[3] > y);
  const gaps = boxes
    .flatMap((box) => [box[3] + PAD / 2, box[1] - PAD / 2])
    .filter((y) => y > from + band * 0.6 && y <= end && !crossed(y));
  return gaps.length > 0 ? Math.max(...gaps) : end;
}

/** The strokes as pictures, dark on white, cut to what is drawn: a band each, empty ones left out. */
export async function inkPictures(strokes: readonly InkEntry[]): Promise<Blob[]> {
  const box = boundsOf(strokes.map(({ stroke }) => stroke));
  if (!box) return [];
  const [left, top, right, bottom] = box;
  const scale = Math.min(2, PICTURE_WIDTH / INK_WIDTH);
  const boxes: Box[] = strokes.map(({ stroke }) => boundsOf([stroke]) ?? [0, 0, 0, 0]);
  const band = Math.max(BAND, Math.ceil((bottom - top + PAD * 2) / (MAX_BANDS * 0.75)));
  const bands: Blob[] = [];
  let from = top - PAD;
  while (from < bottom + PAD && bands.length < MAX_BANDS) {
    const cut = bandEnd(boxes, from, band);
    const to = Math.min(cut, bottom + PAD);
    const next = cut === from + band ? cut - OVERLAP : cut;
    const inside = strokes.filter((_, index) => boxes[index]![3] >= from && boxes[index]![1] <= to);
    const at = from;
    from = next;
    if (inside.length === 0) continue;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((right - left + PAD * 2) * scale));
    canvas.height = Math.max(1, Math.ceil((to - at) * scale));
    const context = canvas.getContext('2d');
    if (!context) return [];
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale, 0, 0, scale, (PAD - left) * scale, -at * scale);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const entry of inside) {
      const { stroke } = entry;
      const shape = keptShape(entry);
      const path = new Path2D(shape.d);
      // The marker under the writing, light: what it marks stays readable.
      const color = stroke.tool === 'marker' ? 'rgba(0,0,0,0.18)' : '#111';
      if (shape.line) {
        context.strokeStyle = color;
        context.lineWidth = stroke.width;
        context.stroke(path);
      } else {
        context.fillStyle = color;
        context.fill(path);
      }
    }
    const picture = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (picture) bands.push(picture);
  }
  return bands;
}

/** A page's reader: a drawing read at once, or some of its strokes (a lasso's). */
export interface InkReading {
  drawing: (key: NodeKey) => Promise<string | null>;
  strokes: (strokes: readonly InkEntry[]) => Promise<string | null>;
}

/** Each page's reader, for a drawing to be read at once („Als Text kopieren“). */
export const readers = new WeakMap<LexicalEditor, InkReading>();

/**
 * What the drawing says now, line by line – kept when its strokes are as read, else read at
 * once; `null`: it could not be read (no AI, offline). Empty: no words in it.
 */
export const readInkNow = (editor: LexicalEditor, key: NodeKey): Promise<string | null> =>
  readers.get(editor)?.drawing(key) ?? Promise.resolve(null);

/** What some strokes say (a lasso's), read at once – not kept. */
export const readStrokesNow = (
  editor: LexicalEditor,
  strokes: readonly InkEntry[],
): Promise<string | null> => readers.get(editor)?.strokes(strokes) ?? Promise.resolve(null);
