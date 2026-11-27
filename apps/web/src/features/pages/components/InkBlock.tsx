import type { AccentColor } from '@slider/shared';
import { $getNodeByKey, type NodeKey } from 'lexical';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { accentColor, ACCENT_COLOR_NAMES } from '@/lib/accent';
import { isTextTarget } from '@/lib/dom';
import {
  cn,
  ColorSwatches,
  IconButton,
  SegmentedControl,
  Toolbar,
  ToolbarDivider,
  type IconName,
} from '@/ui';
import {
  addStrokes,
  boundsOf,
  densify,
  INK_GROW,
  INK_WIDTH,
  inkShape,
  keptShape,
  lassoHolds,
  moveStroke,
  parseInk,
  replaceStrokes,
  setHeight,
  strokeLines,
  touches,
  wipePoints,
  type InkColor,
  type InkPoint,
  type InkShape,
  type InkStroke,
} from '../lib/ink';
import { $isRawBlockNode } from '../lib/nodes';
import {
  claimPenStart,
  inkToolOf,
  penState,
  setPen,
  SIZES,
  usePen,
  type EraserMode,
  type PenStart,
  type PenTool,
} from '../lib/pen';
import { recognize } from '../lib/shapes';
import { useBlockPick } from './useBlockPick';

/*
 * A drawing on a page (```ink, `lib/ink.ts`) – as a drawing in Apple's Notes. Read, its strokes; in
 * Bearbeiten drawn on where it stands: the pen and the mouse draw, a finger scrolls the page. The
 * pen draws thinner and thicker as it presses (perfect-freehand), the marker flat and see-through;
 * held still at its end, a stroke becomes the form it was meant to be (a line, a box, a circle).
 * The lasso picks strokes to move, colour or delete; the eraser wipes whole strokes or just what it
 * touches. Every change is one step back (⌘Z) and its lines in the file. The tools float over the
 * drawing drawn in last (`lib/pen.ts` – one pen for all); drawn near its foot it grows, its grip
 * below makes it taller or shorter.
 */

const TOOLS: { tool: PenTool; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'gesture', label: 'Stift' },
  { tool: 'marker', icon: 'marker', label: 'Marker' },
  { tool: 'lasso', icon: 'highlightAlt', label: 'Lasso' },
  { tool: 'eraser', icon: 'eraser', label: 'Radierer' },
];
const COLORS: AccentColor[] = ['red', 'blue', 'green', 'violet', 'yellow'];
const ERASER_MODES = [
  { value: 'stroke', label: 'Ganze Striche' },
  { value: 'point', label: 'Genau' },
] as const satisfies readonly { value: EraserMode; label: string }[];
/** Room the eraser wipes around the pointer, in the drawing's units. */
const ERASER: Record<EraserMode, number> = { stroke: 10, point: 9 };
/** Points closer than this (units) to the last are left out – smooth lines, short files. */
const STEP = 1.2;
/** Held this long still at its end, a stroke becomes its form (Apple's own pause). */
const HOLD_MS = 550;
/** Moved less than this (units) the pen is held still. */
const HOLD_SLACK = 3;

/** The marker: see-through, the writing under it read through it. */
const MARKER_OPACITY = 0.45;
const colorOf = (color: InkColor) => (color === 'text' ? 'var(--color-fg)' : accentColor(color));
const keyOf = (stroke: InkStroke) => strokeLines(stroke).join('\n');
const NONE: ReadonlySet<string> = new Set();

type Action =
  | {
      kind: 'draw';
      id: number;
      stroke: InkStroke;
      /** Where the pen was last held still, and the wait for it to stay. */
      still: InkPoint;
      timer: number;
      snapped: boolean;
      frame: number;
      predicted: InkPoint[];
    }
  | { kind: 'wipe'; id: number; last: InkPoint; changes: Map<number, InkStroke[]> }
  | { kind: 'lasso'; id: number; loop: InkPoint[] }
  | { kind: 'move'; id: number; from: InkPoint; by: [number, number] };

function StrokePath({
  shape,
  stroke,
  className,
}: {
  shape: InkShape;
  stroke: InkStroke;
  className?: string;
}) {
  const color = colorOf(stroke.color);
  const opacity = stroke.tool === 'marker' ? MARKER_OPACITY : 1;
  return shape.line ? (
    <path
      className={className}
      d={shape.d}
      fill="none"
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={stroke.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ) : (
    <path className={className} d={shape.d} fill={color} fillOpacity={opacity} />
  );
}

/** Paints a stroke into a path element as it is drawn – no React render on every move. */
function paint(path: SVGPathElement | null, stroke: InkStroke | null, last = false) {
  if (!path) return;
  if (!stroke || stroke.points.length === 0) {
    path.setAttribute('d', '');
    return;
  }
  const shape = inkShape(stroke, last);
  const color = colorOf(stroke.color);
  const opacity = String(stroke.tool === 'marker' ? MARKER_OPACITY : 1);
  path.setAttribute('d', shape.d);
  if (shape.line) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(stroke.width));
    path.setAttribute('stroke-opacity', opacity);
    path.removeAttribute('fill-opacity');
  } else {
    path.setAttribute('fill', color);
    path.setAttribute('fill-opacity', opacity);
    path.removeAttribute('stroke');
  }
}

export function InkBlock({ text, nodeKey }: { text: string; nodeKey: NodeKey }) {
  const { editable, picked, pick, editor } = useBlockPick(nodeKey);
  const pen = usePen();
  const ink = useMemo(() => parseInk(text), [text]);
  const [tall, setTall] = useState<number | null>(null);
  const [wiped, setWiped] = useState<ReadonlyMap<number, InkStroke[]> | null>(null);
  const [chosen, setSelection] = useState<ReadonlySet<string>>(NONE);
  const [loop, setLoop] = useState<InkPoint[] | null>(null);
  const [moved, setMoved] = useState<[number, number] | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const live = useRef<SVGPathElement>(null);
  const hover = useRef<SVGCircleElement>(null);
  const action = useRef<Action | null>(null);
  /** The stroke just written, shown live until the file has it – no flicker as it lands. */
  const landing = useRef<string | null>(null);
  const height = tall ?? ink.height;
  const tool = pen.tool;
  const inkTool = inkToolOf(tool);
  const { color, size } = pen[inkTool];
  const active = editable && (pen.at === nodeKey || picked);
  // Another tool, or another drawing: nothing stays picked by the lasso.
  const selection = tool === 'lasso' && pen.at === nodeKey && editable ? chosen : NONE;

  /** The pointer in the drawing's units, with how hard a pen pressed. */
  const pointOf = (event: {
    clientX: number;
    clientY: number;
    pressure?: number;
    pointerType?: string;
  }): InkPoint | null => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const unit = INK_WIDTH / box.width;
    const x = (event.clientX - box.left) * unit;
    const y = (event.clientY - box.top) * unit;
    return event.pointerType === 'pen' && event.pressure ? [x, y, event.pressure] : [x, y];
  };

  /** Writes the block anew – one step back in the page's history. */
  const write = (change: (text: string) => string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isRawBlockNode(node)) node.setText(change(node.getText()));
    });
  };

  /** The block grown for ink reaching `lowest`: room below for the next line. */
  const grown = (now: string, lowest: number) => {
    const { height: at } = parseInk(now);
    return lowest > at - INK_GROW / 3 ? setHeight(now, Math.max(at, lowest) + INK_GROW) : now;
  };

  const lowestOf = (strokes: readonly InkStroke[]) => boundsOf(strokes)?.[3] ?? 0;

  const commit = (stroke: InkStroke) => {
    const key = keyOf(stroke);
    landing.current = key;
    write((now) => grown(addStrokes(now, [stroke]), lowestOf([stroke])));
    // Should the file not take it (a refusal), the live stroke goes all the same.
    window.setTimeout(() => {
      if (landing.current === key) {
        landing.current = null;
        paint(live.current, null);
      }
    }, 1500);
  };

  /** Strokes changed by their keys (what takes each one's place; none: wiped). */
  const rewrite = (changes: ReadonlyMap<string, readonly InkStroke[]>) => {
    write((now) => {
      const byIndex = new Map<number, readonly InkStroke[]>();
      parseInk(now).strokes.forEach((entry, index) => {
        const next = changes.get(entry.key);
        if (next) byIndex.set(index, next);
      });
      const lowest = lowestOf([...changes.values()].flat());
      return grown(replaceStrokes(now, byIndex), lowest);
    });
  };

  // The live stroke goes once the file has it.
  useLayoutEffect(() => {
    const key = landing.current;
    if (key && ink.strokes.some((entry) => entry.key === key)) {
      landing.current = null;
      paint(live.current, null);
    }
  }, [ink]);

  // A drawing new on the page (empty) is the one drawn in: its tools show.
  useEffect(() => {
    if (editable && ink.strokes.length === 0 && penState().at === null) setPen({ at: nodeKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as it comes
  }, []);

  // The Pencil draws, a finger scrolls: a stylus's touch is kept from scrolling the page and from
  // Scribble (iPad's Safari would take a pen's stroke down the page as a scroll and cancel it).
  useEffect(() => {
    const element = surface.current;
    if (!editable || !element) return;
    const hold = (event: TouchEvent) => {
      const touch = event.touches[0] as (Touch & { touchType?: string }) | undefined;
      if (touch?.touchType === 'stylus' || action.current) event.preventDefault();
    };
    element.addEventListener('touchstart', hold, { passive: false });
    element.addEventListener('touchmove', hold, { passive: false });
    return () => {
      element.removeEventListener('touchstart', hold);
      element.removeEventListener('touchmove', hold);
    };
  }, [editable]);

  // ⌫ deletes what the lasso holds, Esc lets it go.
  useEffect(() => {
    if (selection.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTextTarget(event.target)) return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        rewrite(new Map([...selection].map((key) => [key, []])));
        setSelection(NONE);
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        setSelection(NONE);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ── Drawing ─────────────────────────────────────────────────────────

  const schedulePaint = (now: Extract<Action, { kind: 'draw' }>) => {
    if (now.frame) return;
    now.frame = requestAnimationFrame(() => {
      now.frame = 0;
      if (action.current !== now) return;
      const shown = now.snapped
        ? now.stroke
        : { ...now.stroke, points: [...now.stroke.points, ...now.predicted] };
      paint(live.current, shown);
    });
  };

  const snap = (now: Extract<Action, { kind: 'draw' }>) => {
    if (action.current !== now || now.snapped) return;
    const form = recognize(now.stroke.points);
    if (!form) return;
    now.snapped = true;
    now.stroke = {
      tool: now.stroke.tool,
      color: now.stroke.color,
      width: now.stroke.width,
      points: form,
      exact: true,
    };
    schedulePaint(now);
  };

  const holdStill = (now: Extract<Action, { kind: 'draw' }>, point: InkPoint) => {
    if (now.snapped) return;
    if (Math.hypot(point[0] - now.still[0], point[1] - now.still[1]) <= HOLD_SLACK) return;
    now.still = point;
    window.clearTimeout(now.timer);
    now.timer = window.setTimeout(() => snap(now), HOLD_MS);
  };

  const startDraw = (id: number, points: InkPoint[]) => {
    const stroke: InkStroke = { tool: inkTool, color, width: size, points };
    const now: Extract<Action, { kind: 'draw' }> = {
      kind: 'draw',
      id,
      stroke,
      still: points.at(-1)!,
      timer: 0,
      snapped: false,
      frame: 0,
      predicted: [],
    };
    action.current = now;
    now.timer = window.setTimeout(() => snap(now), HOLD_MS);
    schedulePaint(now);
  };

  const endDraw = (now: Extract<Action, { kind: 'draw' }>) => {
    window.clearTimeout(now.timer);
    cancelAnimationFrame(now.frame);
    action.current = null;
    // Shown as it will be kept (the predicted points gone, the stroke whole).
    paint(live.current, now.stroke, true);
    commit(now.stroke);
  };

  // A stroke begun outside the drawing (the Pencil anywhere on the page – `PenCatcher`) goes on here.
  useEffect(() => {
    if (!editable || pen.start?.key !== nodeKey) return;
    const start: PenStart | null = claimPenStart(nodeKey);
    if (!start || start.points.length === 0) return;
    setPen({ at: nodeKey });
    startDraw(start.pointerId, start.points);
    const now = action.current as Extract<Action, { kind: 'draw' }>;
    if (start.done) {
      endDraw(now);
      return;
    }
    try {
      surface.current?.setPointerCapture(start.pointerId);
    } catch {
      // The pen is already up: what it drew is the stroke.
      endDraw(now);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claims when one is meant for it
  }, [pen.start, editable]);

  // ── Wiping ──────────────────────────────────────────────────────────

  const wipeAt = (now: Extract<Action, { kind: 'wipe' }>, point: InkPoint) => {
    const mode = penState().eraser;
    const radius = ERASER[mode];
    let changed = false;
    // Walked in small steps from the last point: a fast eraser leaves nothing between.
    for (const at of densify([now.last, point], radius / 2).slice(1)) {
      ink.strokes.forEach(({ stroke }, index) => {
        const was = now.changes.get(index);
        if (mode === 'stroke') {
          if (!was && touches(stroke, at, radius)) {
            now.changes.set(index, []);
            changed = true;
          }
          return;
        }
        const pieces = was ?? [stroke];
        const next = pieces.flatMap((piece) => wipePoints(piece, at, radius));
        if (next.length !== pieces.length || next.some((piece, n) => piece !== pieces[n])) {
          now.changes.set(
            index,
            next.filter((piece) => piece.points.length > 0),
          );
          changed = true;
        }
      });
    }
    now.last = point;
    if (changed) setWiped(new Map(now.changes));
  };

  // ── Lasso ───────────────────────────────────────────────────────────

  const held = useMemo(
    () => ink.strokes.filter((entry) => selection.has(entry.key)),
    [ink, selection],
  );
  const heldBox = useMemo(() => boundsOf(held.map((entry) => entry.stroke)), [held]);

  const insideHeld = ([x, y]: InkPoint) =>
    heldBox !== null &&
    x >= heldBox[0] - 12 &&
    x <= heldBox[2] + 12 &&
    y >= heldBox[1] - 12 &&
    y <= heldBox[3] + 12;

  const recolor = (next: InkColor) => {
    const changes = new Map<string, InkStroke[]>();
    for (const entry of held) changes.set(entry.key, [{ ...entry.stroke, color: next }]);
    rewrite(changes);
    setSelection(new Set(held.map((entry) => keyOf({ ...entry.stroke, color: next }))));
  };

  const deleteHeld = () => {
    rewrite(new Map(held.map((entry) => [entry.key, []])));
    setSelection(NONE);
  };

  // ── Pointer ─────────────────────────────────────────────────────────

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    // A finger scrolls; only the main button (or a pen's eraser end) draws.
    if (!editable || event.pointerType === 'touch' || (event.button !== 0 && event.button !== 5))
      return;
    const point = pointOf(event);
    if (!point || action.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pen.at !== nodeKey) setPen({ at: nodeKey });
    if (hover.current) hover.current.style.opacity = '0';
    // The Pencil's other end, or a pen's eraser button, wipes.
    if (tool === 'eraser' || (event.buttons & 32) !== 0) {
      const now: Action = { kind: 'wipe', id: event.pointerId, last: point, changes: new Map() };
      action.current = now;
      wipeAt(now, point);
      return;
    }
    if (tool === 'lasso') {
      if (selection.size > 0 && insideHeld(point)) {
        action.current = { kind: 'move', id: event.pointerId, from: point, by: [0, 0] };
        setMoved([0, 0]);
        return;
      }
      setSelection(NONE);
      action.current = { kind: 'lasso', id: event.pointerId, loop: [point] };
      setLoop([point]);
      return;
    }
    startDraw(event.pointerId, [point]);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const now = action.current;
    if (!now) {
      // The Pencil above the drawing: where it will draw, its colour and size (iPad's hover).
      const dot = hover.current;
      const point = event.pointerType === 'pen' && editable ? pointOf(event) : null;
      if (!dot) return;
      if (!point) {
        dot.style.opacity = '0';
        return;
      }
      dot.setAttribute('cx', String(point[0]));
      dot.setAttribute('cy', String(point[1]));
      dot.style.opacity = '1';
      return;
    }
    if (now.id !== event.pointerId) return;
    // A pen reports more often than frames come: every point it gave.
    const native = event.nativeEvent;
    const events = native.getCoalescedEvents?.() ?? [];
    const all = events.length > 0 ? events : [native];
    if (now.kind === 'wipe') {
      for (const each of all) {
        const point = pointOf(each);
        if (point) wipeAt(now, point);
      }
      return;
    }
    if (now.kind === 'lasso') {
      const point = pointOf(native);
      if (point) {
        now.loop.push(point);
        setLoop([...now.loop]);
      }
      return;
    }
    if (now.kind === 'move') {
      const point = pointOf(native);
      if (point) {
        now.by = [point[0] - now.from[0], point[1] - now.from[1]];
        setMoved(now.by);
      }
      return;
    }
    if (now.snapped) return;
    const { points } = now.stroke;
    for (const each of all) {
      const point = pointOf(each);
      const last = points.at(-1);
      if (!point || (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < STEP)) continue;
      points.push(point);
      holdStill(now, point);
    }
    // Where the pen is about to be: drawn ahead, so the ink keeps up with the tip.
    now.predicted = (native.getPredictedEvents?.() ?? [])
      .slice(0, 2)
      .map((each) => pointOf(each))
      .filter((point): point is InkPoint => point !== null);
    schedulePaint(now);
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const now = action.current;
    if (now?.id !== event.pointerId) return;
    if (now.kind === 'draw') {
      endDraw(now);
      return;
    }
    action.current = null;
    if (now.kind === 'wipe') {
      setWiped(null);
      if (now.changes.size > 0) {
        const changes = new Map<string, InkStroke[]>();
        for (const [index, pieces] of now.changes) changes.set(ink.strokes[index]!.key, pieces);
        rewrite(changes);
      }
      return;
    }
    if (now.kind === 'lasso') {
      setLoop(null);
      const keys = ink.strokes
        .filter((entry) => lassoHolds(entry.stroke, now.loop))
        .map((entry) => entry.key);
      setSelection(new Set(keys));
      return;
    }
    setMoved(null);
    const [dx, dy] = now.by;
    if (Math.hypot(dx, dy) < 1) return;
    const changes = new Map<string, InkStroke[]>();
    const next: string[] = [];
    for (const entry of held) {
      const stroke = moveStroke(entry.stroke, dx, dy);
      changes.set(entry.key, [stroke]);
      next.push(keyOf(stroke));
    }
    rewrite(changes);
    setSelection(new Set(next));
  };

  const onPointerCancel = (event: PointerEvent<SVGSVGElement>) => {
    const now = action.current;
    if (now?.id !== event.pointerId) return;
    action.current = null;
    if (now.kind === 'draw') {
      window.clearTimeout(now.timer);
      cancelAnimationFrame(now.frame);
      paint(live.current, null);
    }
    setWiped(null);
    setLoop(null);
    setMoved(null);
  };

  // A pen's or a mouse's eraser button can come as a stroke of its own – the palm on the screen never
  // does (touches only scroll), and while a stroke is drawn the page does not scroll under it.
  useEffect(() => {
    if (!editable) return;
    const still = (event: TouchEvent) => {
      if (action.current) event.preventDefault();
    };
    window.addEventListener('touchmove', still, { passive: false });
    return () => window.removeEventListener('touchmove', still);
  }, [editable]);

  // ── Tools ───────────────────────────────────────────────────────────

  const pickTool = (next: PenTool) => setPen({ tool: next, at: nodeKey });
  const pickColor = (next: InkColor) => {
    if (tool === 'lasso' && held.length > 0) {
      recolor(next);
      return;
    }
    setPen((now) => {
      const forTool = inkToolOf(now.tool);
      return {
        [forTool]: { ...now[forTool], color: next },
        tool: now.tool === 'eraser' || now.tool === 'lasso' ? forTool : now.tool,
      };
    });
  };
  const pickSize = (next: number) =>
    setPen((now) => ({ [inkToolOf(now.tool)]: { ...now[inkToolOf(now.tool)], size: next } }));

  // ── The grip below: dragged, the drawing is as tall as it is pulled (not shorter than its ink).

  const grip = useRef<{ id: number; y: number; from: number } | null>(null);
  const lowestInk = useMemo(() => lowestOf(ink.strokes.map((entry) => entry.stroke)), [ink]);
  const onGripDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    grip.current = { id: event.pointerId, y: event.clientY, from: ink.height };
  };
  const onGripMove = (event: PointerEvent<HTMLDivElement>) => {
    const now = grip.current;
    const box = surface.current?.getBoundingClientRect();
    if (now?.id !== event.pointerId || !box) return;
    const unit = INK_WIDTH / box.width;
    setTall(Math.max(lowestInk + 20, 120, now.from + (event.clientY - now.y) * unit));
  };
  const onGripUp = (event: PointerEvent<HTMLDivElement>) => {
    if (grip.current?.id !== event.pointerId) return;
    grip.current = null;
    const next = tall;
    setTall(null);
    if (next !== null && Math.round(next) !== ink.height) write((now) => setHeight(now, next));
  };

  // ── Drawn ───────────────────────────────────────────────────────────

  // Read, as tall as its ink (the room left to write in is Bearbeiten's).
  const shown = editable ? height : Math.min(height, lowestInk + 16);
  const box: readonly [number, number, number, number] | null =
    heldBox && moved
      ? [heldBox[0] + moved[0], heldBox[1] + moved[1], heldBox[2] + moved[0], heldBox[3] + moved[1]]
      : heldBox;
  const strokes = ink.strokes.map((entry, index) => {
    const pieces = wiped?.get(index);
    if (pieces) {
      return pieces.map((piece, n) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one stroke, in order, for a moment.
        <StrokePath key={`${index}-${n}`} shape={inkShape(piece)} stroke={piece} />
      ));
    }
    const isHeld = selection.has(entry.key);
    return (
      <StrokePath
        // biome-ignore lint/suspicious/noArrayIndexKey: strokes are lines of the file, in order.
        key={index}
        className={cn('page-ink-stroke', isHeld && 'page-ink-held')}
        shape={keptShape(entry)}
        stroke={entry.stroke}
      />
    );
  });

  const drawn = (
    <svg
      ref={surface}
      viewBox={`0 0 ${INK_WIDTH} ${Math.round(shown)}`}
      className={cn('page-ink-surface', editable && `page-ink-${tool}`)}
      role="img"
      aria-label={ink.strokes.length > 0 ? 'Zeichnung' : 'Leere Zeichnung'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        if (hover.current) hover.current.style.opacity = '0';
      }}
    >
      {moved ? (
        <>
          {strokes.filter((_, index) => !selection.has(ink.strokes[index]!.key))}
          <g transform={`translate(${moved[0]} ${moved[1]})`}>
            {strokes.filter((_, index) => selection.has(ink.strokes[index]!.key))}
          </g>
        </>
      ) : (
        strokes
      )}
      {editable && (
        <>
          <path ref={live} className="page-ink-live" />
          {loop && loop.length > 1 && (
            <path
              className="page-ink-loop"
              d={`M${loop.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`}
            />
          )}
          {box && !loop && (
            <rect
              className="page-ink-box"
              x={box[0] - 8}
              y={box[1] - 8}
              width={box[2] - box[0] + 16}
              height={box[3] - box[1] + 16}
              rx={6}
            />
          )}
          <circle
            ref={hover}
            className="page-ink-hover"
            r={tool === 'eraser' ? ERASER[pen.eraser] : Math.max(size / 2, 2)}
            fill={tool === 'eraser' || tool === 'lasso' ? 'none' : colorOf(color)}
            fillOpacity={inkTool === 'marker' ? MARKER_OPACITY : 0.7}
            style={{ opacity: 0 }}
          />
        </>
      )}
    </svg>
  );

  if (!editable) return ink.strokes.length > 0 ? <div className="page-ink">{drawn}</div> : null;

  const sizes = SIZES[inkTool];

  return (
    <div
      className={cn(
        'page-ink page-ink-editing',
        active && 'page-ink-active',
        picked && 'page-picked',
      )}
      contentEditable={false}
    >
      {active && (
        <div className="page-ink-bar">
          <Toolbar label="Zeichnen" tone="elevated" className="page-ink-tools">
            {TOOLS.map((option) => (
              <IconButton
                key={option.tool}
                size="sm"
                icon={option.icon}
                label={option.label}
                active={tool === option.tool}
                onClick={() => pickTool(option.tool)}
              />
            ))}
            <ToolbarDivider />
            <button
              type="button"
              aria-label="Farbe Text"
              title="Farbe Text"
              aria-pressed={tool !== 'eraser' && color === 'text'}
              onClick={() => pickColor('text')}
              className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-hover"
            >
              <span
                className={cn(
                  'size-4 rounded-full bg-fg inset-ring inset-ring-surface-4',
                  tool !== 'eraser' &&
                    color === 'text' &&
                    'ring-2 ring-fg ring-offset-2 ring-offset-placeholder',
                )}
              />
            </button>
            <ColorSwatches
              variant="dot"
              label="Farben"
              colors={COLORS}
              value={tool === 'eraser' || color === 'text' ? null : color}
              swatchLabel={(swatch) => `Farbe ${ACCENT_COLOR_NAMES[swatch]}`}
              onChange={pickColor}
              className="gap-1"
            />
            <ToolbarDivider />
            {tool === 'eraser' ? (
              <SegmentedControl
                size="xs"
                label="Radieren"
                segments={ERASER_MODES}
                value={pen.eraser}
                onChange={(next) => setPen({ eraser: next })}
              />
            ) : tool === 'lasso' ? (
              <IconButton
                size="sm"
                icon="delete"
                label="Auswahl löschen"
                disabled={held.length === 0}
                onClick={deleteHeld}
              />
            ) : (
              sizes.map((each, n) => (
                <button
                  key={each}
                  type="button"
                  aria-label={['Fein', 'Mittel', 'Breit'][n]}
                  title={['Fein', 'Mittel', 'Breit'][n]}
                  aria-pressed={size === each}
                  onClick={() => pickSize(each)}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full transition-colors hover:bg-hover',
                    size === each && 'bg-selected',
                  )}
                >
                  <span
                    className="rounded-full bg-fg"
                    style={{ width: 4 + n * 3, height: 4 + n * 3 }}
                  />
                </button>
              ))
            )}
            <ToolbarDivider />
            {/* The drawing whole, picked – ⌫ deletes it, as a picture. */}
            <IconButton size="sm" icon="cursorBox" label="Zeichnung auswählen" onClick={pick} />
          </Toolbar>
        </div>
      )}
      {drawn}
      <div
        className="page-ink-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Höhe der Zeichnung"
        title="Ziehen: höher oder niedriger"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={() => {
          grip.current = null;
          setTall(null);
        }}
      />
    </div>
  );
}
