import type { LexicalEditor, NodeKey } from 'lexical';
import { boundsOf, INK_WIDTH, keptShape, type Ink } from './ink';

/* What a drawing says (`components/InkReader.tsx`): its picture for the AI, and its reading asked at once. */

/** The update that writes what was read: sent like typing, in Lesen too (`PageEditor`). */
export const INK_READ_TAG = 'ink-read';
/** The picture's width at most (px): a page's line of writing stays a few dozen pixels high. */
const PICTURE_WIDTH = 1400;
const PAD = 24;

/** The strokes as a picture: dark on white, cut to what is drawn. */
export async function inkPicture(ink: Ink): Promise<Blob | null> {
  const box = boundsOf(ink.strokes.map(({ stroke }) => stroke));
  if (!box) return null;
  const [left, top, right, bottom] = box;
  const scale = Math.min(2, PICTURE_WIDTH / INK_WIDTH);
  const width = Math.ceil((right - left + PAD * 2) * scale);
  const height = Math.ceil((bottom - top + PAD * 2) * scale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, Math.min(height, 8000));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, (PAD - left) * scale, (PAD - top) * scale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const entry of ink.strokes) {
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
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Each page's reader, for a drawing to be read at once („Als Text kopieren“). */
export const readers = new WeakMap<LexicalEditor, (key: NodeKey) => Promise<string | null>>();

/**
 * What the drawing says now, line by line – kept when its strokes are as read, else read at
 * once; `null`: it could not be read (no AI, offline). Empty: no words in it.
 */
export const readInkNow = (editor: LexicalEditor, key: NodeKey): Promise<string | null> =>
  readers.get(editor)?.(key) ?? Promise.resolve(null);
