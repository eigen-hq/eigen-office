import type { LexicalEditor, NodeKey } from 'lexical';
import { useEffect, useState } from 'react';
import { boundsOf, type InkEntry } from './ink';

/*
 * What a drawing says (`components/InkReader.tsx`), read on the device only – never sent away for
 * it: the installed app's own recognition (iPad, Android: `window.sliderInk`), else the browser's
 * (Chrome's Handwriting Recognition API, where it has the page's language). Elsewhere a drawing
 * stays a drawing, unread.
 */

/** The update that writes what was read: sent like typing, in Lesen too (`PageEditor`). */
export const INK_READ_TAG = 'ink-read';

export interface HandwritingPoint {
  x: number;
  y: number;
  /** Milliseconds into the stroke – not kept in the file, so left out. */
  t?: number;
}
/** One line of writing: its strokes as drawn, each its points (1000-wide frame). */
export type InkLine = HandwritingPoint[][];

/**
 * What an installed app (iPad, Android) puts on `window.sliderInk`: its own handwriting
 * recognition, on the device – the text of each line, in order.
 */
export interface InkBridge {
  recognize(lines: readonly InkLine[], languages: readonly string[]): Promise<string[]>;
}

declare global {
  interface Window {
    sliderInk?: InkBridge;
  }
}

type Recognize = (lines: readonly InkLine[]) => Promise<string[]>;

/** Chrome's Handwriting Recognition API – as much of it as is used here. */
interface Handwriting {
  createHandwritingRecognizer?: (constraint: { languages: string[] }) => Promise<{
    startDrawing(hints: { recognitionType?: string; inputType?: string }): {
      addStroke(stroke: unknown): void;
      getPrediction(): Promise<{ text: string }[]>;
      clear(): void;
    };
  }>;
  queryHandwritingRecognizer?: (constraint: { languages: string[] }) => Promise<unknown>;
  queryHandwritingRecognizerSupport?: (constraint: { languages: string[] }) => Promise<unknown>;
}
type Stroke = { addPoint(point: HandwritingPoint): void };

/** The page's language, as the recognisers take it. */
const languages = () => [document.documentElement.lang.split('-')[0] || 'de'];

async function browserRecognizer(): Promise<Recognize | null> {
  const nav = navigator as Navigator & Handwriting;
  const Stroke = (window as { HandwritingStroke?: new () => Stroke }).HandwritingStroke;
  if (!nav.createHandwritingRecognizer || !Stroke) return null;
  try {
    const query = nav.queryHandwritingRecognizer ?? nav.queryHandwritingRecognizerSupport;
    if (query && !(await query.call(nav, { languages: languages() }))) return null;
    const recognizer = await nav.createHandwritingRecognizer({ languages: languages() });
    return (lines) =>
      Promise.all(
        lines.map(async (line) => {
          const drawing = recognizer.startDrawing({ recognitionType: 'text', inputType: 'stylus' });
          for (const points of line) {
            const stroke = new Stroke();
            for (const point of points) stroke.addPoint(point);
            drawing.addStroke(stroke);
          }
          const [best] = await drawing.getPrediction();
          drawing.clear();
          return best?.text ?? '';
        }),
      );
  } catch {
    return null;
  }
}

let found: Promise<Recognize | null> | undefined;

/** How this device reads handwriting – `null`: it does not. */
export function inkRecognizer(): Promise<Recognize | null> {
  found ??= (async () => {
    const bridge = typeof window === 'undefined' ? undefined : window.sliderInk;
    if (bridge) return (lines) => bridge.recognize(lines, languages());
    return browserRecognizer();
  })();
  return found;
}

/** Whether this device reads handwriting (the drawing's „Als Text kopieren“, „In Text umwandeln“). */
export function useInkRecognizer(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    void inkRecognizer().then((recognize) => live && setCan(recognize !== null));
    return () => {
      live = false;
    };
  }, []);
  return can;
}

/**
 * The writing in some strokes, line by line, top down: pen strokes drawn freehand (no marker, no
 * form drawn true), a line those whose middles lie within its height, in the order drawn.
 */
export function inkLines(strokes: readonly InkEntry[]): InkLine[] {
  const written = strokes
    .map((entry, index) => ({ entry, index, box: boundsOf([entry.stroke]) }))
    .filter(
      (each): each is typeof each & { box: [number, number, number, number] } =>
        each.box !== null && each.entry.stroke.tool === 'pen' && !each.entry.stroke.exact,
    )
    .sort((a, b) => a.box[1] - b.box[1]);
  const lines: { top: number; bottom: number; members: typeof written }[] = [];
  for (const each of written) {
    const middle = (each.box[1] + each.box[3]) / 2;
    const line = lines.find((one) => middle >= one.top && middle <= one.bottom);
    if (line) {
      line.members.push(each);
      line.top = Math.min(line.top, each.box[1]);
      line.bottom = Math.max(line.bottom, each.box[3]);
    } else lines.push({ top: each.box[1], bottom: each.box[3], members: [each] });
  }
  return lines
    .sort((a, b) => a.top - b.top)
    .map((line) =>
      line.members
        .sort((a, b) => a.index - b.index)
        .map(({ entry }) => entry.stroke.points.map(([x, y]) => ({ x, y }))),
    );
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
 * once; `null`: it could not be read (this device does not). Empty: no words in it.
 */
export const readInkNow = (editor: LexicalEditor, key: NodeKey): Promise<string | null> =>
  readers.get(editor)?.drawing(key) ?? Promise.resolve(null);

/** What some strokes say (a lasso's), read at once – not kept. */
export const readStrokesNow = (
  editor: LexicalEditor,
  strokes: readonly InkEntry[],
): Promise<string | null> => readers.get(editor)?.strokes(strokes) ?? Promise.resolve(null);
