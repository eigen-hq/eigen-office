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
/** A tall drawing goes in bands this tall (units) – each a picture the AI reads at full size. */
const BAND = 1000;
/** The most bands sent (as the server takes): what lies below is not read. */
const MAX_BANDS = 8;
const PAD = 24;

/** The strokes as pictures, dark on white, cut to what is drawn: a band each, empty ones left out. */
export async function inkPictures(strokes: readonly InkEntry[]): Promise<Blob[]> {
  const box = boundsOf(strokes.map(({ stroke }) => stroke));
  if (!box) return [];
  const [left, top, right, bottom] = box;
  const scale = Math.min(2, PICTURE_WIDTH / INK_WIDTH);
  const bands: Blob[] = [];
  for (let from = top - PAD; from < bottom + PAD && bands.length < MAX_BANDS; from += BAND) {
    const to = Math.min(from + BAND, bottom + PAD);
    const inside = strokes.filter(({ stroke }) => {
      const each = boundsOf([stroke]);
      return each !== null && each[3] >= from && each[1] <= to;
    });
    if (inside.length === 0) continue;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((right - left + PAD * 2) * scale));
    canvas.height = Math.max(1, Math.ceil((to - from) * scale));
    const context = canvas.getContext('2d');
    if (!context) return [];
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale, 0, 0, scale, (PAD - left) * scale, -from * scale);
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
    const band = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (band) bands.push(band);
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
