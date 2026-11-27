import type { NodeKey } from 'lexical';
import { useSyncExternalStore } from 'react';
import type { InkColor, InkPoint, InkTool } from './ink';

/*
 * The pen in hand, the same for every drawing on every page (as Apple's tool picker): the tool,
 * each tool's colour and size, how the eraser wipes – and the drawing it is at (its palette shows
 * while one is). Kept for the tab; a new drawing starts with the pen last picked.
 */

export type PenTool = InkTool | 'eraser' | 'lasso';
export type EraserMode = 'stroke' | 'point';

export interface PenState {
  tool: PenTool;
  eraser: EraserMode;
  pen: { color: InkColor; size: number };
  marker: { color: InkColor; size: number };
  /** The drawing drawn in last, its palette shown; `null`: none. */
  at: NodeKey | null;
  /** A stroke the Pencil began outside any drawing, for the drawing made for it to go on with. */
  start: PenStart | null;
}

/**
 * A stroke begun where no drawing was (`PenCatcher`): its points so far in the drawing's units, the
 * drawing it goes on in (`null` while that is being made), and whether the pen is already up.
 */
export interface PenStart {
  key: NodeKey | null;
  pointerId: number;
  points: InkPoint[];
  done: boolean;
}

/** Three sizes a tool comes in, in the drawing's units (it is 1000 wide). */
export const SIZES: Record<InkTool, readonly [number, number, number]> = {
  pen: [3, 5, 9],
  marker: [14, 24, 36],
};

let state: PenState = {
  tool: 'pen',
  eraser: 'stroke',
  pen: { color: 'text', size: SIZES.pen[1] },
  marker: { color: 'yellow', size: SIZES.marker[1] },
  at: null,
  start: null,
};
const listeners = new Set<() => void>();
/** The tool in hand before this one – what the Pencil's double tap goes back to. */
let before: PenTool = 'pen';

export const penState = () => state;

export function setPen(change: Partial<PenState> | ((now: PenState) => Partial<PenState>)) {
  const next = { ...state, ...(typeof change === 'function' ? change(state) : change) };
  if (
    Object.keys(next).every((key) => next[key as keyof PenState] === state[key as keyof PenState])
  )
    return;
  if (next.tool !== state.tool) before = state.tool;
  state = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePen = (): PenState => useSyncExternalStore(subscribe, penState, penState);

/** The tool that lays ink down – the pen unless the marker is in hand. */
export const inkToolOf = (tool: PenTool): InkTool => (tool === 'marker' ? 'marker' : 'pen');

/** The stroke begun outside, taken by the drawing it was meant for (once). */
export function claimPenStart(key: NodeKey): PenStart | null {
  const start = state.start;
  if (!start || start.key !== key) return null;
  setPen({ start: null });
  return { ...start, points: [...start.points] };
}

/**
 * The Pencil's double tap, as the iPad is set to answer it (the installed app sends it,
 * `sliderpenciltap`): `eraser` – the eraser, or back from it to the tool before; `previous` – the
 * tool before. Anything else the iPad offers (a palette) has none here.
 */
export function pencilTap(action: string) {
  if (action === 'eraser')
    setPen({ tool: state.tool === 'eraser' ? (before === 'eraser' ? 'pen' : before) : 'eraser' });
  else if (action === 'previous') setPen({ tool: before });
}

if (typeof window !== 'undefined')
  window.addEventListener('sliderpenciltap', (event) => {
    const action = (event as CustomEvent<{ action?: string }>).detail?.action;
    if (action) pencilTap(action);
  });
