import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { useEffect, useEffectEvent } from 'react';
import {
  liftInk,
  INK_GROW,
  INK_HEIGHT,
  INK_WIDTH,
  newInk,
  parseInk,
  setHeight,
  type InkPoint,
} from '../lib/ink';
import { $createRawBlockNode, $isRawBlockNode } from '../lib/nodes';
import { penState, setPen, type PenStart } from '../lib/pen';

/*
 * The Pencil writes anywhere on a page (as in Apple's Notes): put down where no drawing is, it
 * draws all the same – a drawing is made where it touched (before the block under it, at the end,
 * or the one just above made taller) and the stroke goes on in it. From Lesen it is Bearbeiten
 * first. A tap stays a tap (the caret, a link). A finger scrolls, a mouse selects; on a desk – no
 * touch screen – a pen is someone's mouse and draws only in a drawing („/Zeichnung“).
 */

/** Moved further than this (px) a pen's touch is a stroke, not a tap. */
const TAP_SLACK = 4;
/** A drawing this close (px) to the pen – above it or below – is drawn on, not a new one made. */
const NEAR_INK = 56;
/** Room (px) a new drawing leaves above the first touch – for the tall letters of a line. */
const HEAD_ROOM = 40;

type Client = readonly [x: number, y: number, pressure: number];

interface Plan {
  /** The drawing drawn on, or the block a new one goes before; `null`: at the end. */
  key: NodeKey | null;
  extend: boolean;
  /** Where the drawing's sheet is to start on the screen, as the page stood at the touch. */
  top: number;
  /** How tall it must be for the touch (units). */
  height: number;
  /** Drawn on just above it: its strokes moved down this much (units), room above them. */
  lift: number;
}

const isStylus = (event: TouchEvent) =>
  Array.from(event.changedTouches).some(
    (touch) => (touch as Touch & { touchType?: string }).touchType === 'stylus',
  );

/** What a pen's touch must leave to the page: tools, fields, a drawing being edited. */
const OWN = '.page-ink-editing, button, input, textarea, select, [role="button"], [role="menu"]';

function scrollerOf(element: HTMLElement): HTMLElement {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight)
      return at;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Where the drawing for a touch at y goes – read from the page as it stands. */
function planFor(editor: LexicalEditor, root: HTMLElement, y: number): Plan {
  const unit = INK_WIDTH / Math.max(root.clientWidth, 1);
  const blocks = Array.from(root.children) as HTMLElement[];
  const keyOf = (element: HTMLElement) =>
    editor.read(() => $getNearestNodeFromDOMNode(element)?.getTopLevelElement()?.getKey() ?? null);
  const inkOf = (element: HTMLElement | undefined) =>
    element?.querySelector<SVGSVGElement>('.page-ink-surface') ?? null;
  const at = blocks.findIndex((block) => block.getBoundingClientRect().bottom > y);
  const under = at >= 0 ? blocks[at] : undefined;
  const above = at > 0 ? blocks[at - 1] : at < 0 ? blocks.at(-1) : undefined;
  const below = at >= 0 ? blocks[at + 1] : undefined;
  // On a drawing (read), or near one: that drawing – taller below, or with room above its strokes.
  for (const near of [under, above, below]) {
    const sheet = inkOf(near);
    if (!near || !sheet) continue;
    const box = sheet.getBoundingClientRect();
    if (y >= box.top && y <= box.bottom + NEAR_INK) {
      return {
        key: keyOf(near),
        extend: true,
        top: box.top,
        height: (y - box.top) * unit + INK_GROW,
        lift: 0,
      };
    }
    if (y < box.top && y >= box.top - NEAR_INK) {
      const lift = (box.top - y + HEAD_ROOM) * unit;
      const top = box.top - lift / unit;
      return { key: keyOf(near), extend: true, top, height: 0, lift };
    }
  }
  if (under) {
    const top = Math.min(under.getBoundingClientRect().top, y - HEAD_ROOM);
    return {
      key: keyOf(under),
      extend: false,
      top,
      height: Math.max(INK_HEIGHT, (y - top) * unit + INK_GROW),
      lift: 0,
    };
  }
  const last = blocks.at(-1)?.getBoundingClientRect();
  const top = Math.min(last ? last.bottom + 8 : root.getBoundingClientRect().top, y - HEAD_ROOM);
  return {
    key: null,
    extend: false,
    top,
    height: Math.max(INK_HEIGHT, (y - top) * unit + INK_GROW),
    lift: 0,
  };
}

/** Makes (or makes taller) the drawing of the plan; its key. */
function place(editor: LexicalEditor, plan: Plan): NodeKey | null {
  let key: NodeKey | null = null;
  editor.update(
    () => {
      const anchor = plan.key ? $getNodeByKey(plan.key) : null;
      if (plan.extend && $isRawBlockNode(anchor)) {
        const text = plan.lift > 0 ? liftInk(anchor.getText(), plan.lift) : anchor.getText();
        if (plan.height > parseInk(text).height) anchor.setText(setHeight(text, plan.height));
        else if (plan.lift > 0) anchor.setText(text);
        key = anchor.getKey();
        return;
      }
      const ink = $createRawBlockNode(newInk(Math.round(plan.height)), 'ink');
      if (anchor) anchor.insertBefore(ink);
      else {
        // At the end: a line after it to go on typing in.
        $getRoot().append(ink, $createParagraphNode());
      }
      key = ink.getKey();
    },
    { discrete: true },
  );
  return key;
}

export function PenCatcher({ onEdit }: { onEdit?: () => void }) {
  const [editor] = useLexicalComposerContext();
  const edit = useEffectEvent(() => onEdit?.());
  const canEdit = onEdit !== undefined;

  // In the installed app: the Pencil draws here, the iPad's Scribble keeps out (`InkBridge`) –
  // but for a field tapped into, which Scribble writes in.
  useEffect(() => {
    const bridge = window.sliderInk;
    if (!bridge?.pencilDraws) return;
    const inField = () => document.activeElement?.matches('input, textarea, select') ?? false;
    const tell = () => bridge.pencilDraws?.((editor.isEditable() || canEdit) && !inField());
    tell();
    const off = editor.registerEditableListener(tell);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(tell);
    };
    document.addEventListener('focusin', tell);
    document.addEventListener('focusout', later);
    return () => {
      clearTimeout(timer);
      off();
      document.removeEventListener('focusin', tell);
      document.removeEventListener('focusout', later);
      bridge.pencilDraws?.(false);
    };
  }, [editor, canEdit]);

  useEffect(() => {
    if (!window.matchMedia('(any-pointer: coarse)').matches) return;
    let off = () => {};
    const unroot = editor.registerRootListener((root) => {
      off();
      off = () => {};
      if (!root) return;
      off = watch(root);
    });

    function watch(root: HTMLElement) {
      /** A stylus touch kept from scrolling and from Scribble – its click is the tap's, done here. */
      let held = false;
      // A pen is down here: its touch is the stylus's even without `touchType` (Safari only) –
      // Chrome on Android would scroll and cancel the stroke. `pointerdown` comes before `touchstart`.
      let penDown = false;
      const onTouch = (event: TouchEvent) => {
        if (!(penDown || isStylus(event)) || (event.target as Element).closest(OWN)) return;
        if (!editor.isEditable() && !canEdit) return;
        held = true;
        event.preventDefault();
      };

      const onDown = (event: PointerEvent) => {
        if (event.pointerType !== 'pen' || event.button !== 0) return;
        const target = event.target as Element;
        if (target.closest(OWN)) return;
        if (!editor.isEditable() && !canEdit) return;
        event.preventDefault();
        penDown = true;
        const id = event.pointerId;
        const down = { x: event.clientX, y: event.clientY };
        const seen: Client[] = [[event.clientX, event.clientY, event.pressure]];
        let start: PenStart | null = null;
        let toUnits: ((point: Client) => InkPoint) | null = null;
        let begun = false;
        let done = false;
        let cancelled = false;

        const push = (point: Client) => {
          if (start && toUnits && penState().start === start) start.points.push(toUnits(point));
          else seen.push(point);
        };

        /** Once the drawing stands: where it is, the page scrolled back to where it was touched. */
        const land = (key: NodeKey, plan: Plan, tries = 0) => {
          const sheet = editor
            .getElementByKey(key)
            ?.querySelector<SVGSVGElement>('.page-ink-editing .page-ink-surface');
          if (!sheet) {
            if (tries < 30) requestAnimationFrame(() => land(key, plan, tries + 1));
            else stop();
            return;
          }
          const drift = sheet.getBoundingClientRect().top - plan.top;
          if (Math.abs(drift) > 0.5) scrollerOf(root).scrollBy({ top: drift, behavior: 'instant' });
          const box = sheet.getBoundingClientRect();
          const unit = INK_WIDTH / box.width;
          const top = box.top;
          toUnits = ([x, y, pressure]) => {
            const ux = (x - box.left) * unit;
            const uy = (y - top) * unit;
            return pressure > 0 ? [ux, uy, pressure] : [ux, uy];
          };
          start = { key, pointerId: id, points: seen.map(toUnits), done };
          setPen({ start, at: key });
        };

        const begin = () => {
          begun = true;
          const plan = planFor(editor, root, down.y);
          const go = () => {
            // Cancelled while Bearbeiten was coming: nothing is put on the page.
            if (cancelled) return;
            const key = place(editor, plan);
            if (key) requestAnimationFrame(() => land(key, plan));
            else stop();
          };
          if (editor.isEditable()) {
            go();
            return;
          }
          // From Lesen: Bearbeiten first – what is drawn in Lesen would not be kept.
          setPen({ start: { key: null, pointerId: id, points: [], done: false } });
          const unlisten = editor.registerEditableListener((editable) => {
            if (!editable) return;
            unlisten();
            // Not inside Lexical's own switch (an update there only waits its turn): the next frame,
            // Bearbeiten drawn.
            requestAnimationFrame(go);
          });
          edit();
        };

        const onMove = (move: PointerEvent) => {
          if (move.pointerId !== id) return;
          if (start && penState().start !== start) {
            stop();
            return;
          }
          const events = move.getCoalescedEvents?.() ?? [];
          for (const each of events.length > 0 ? events : [move]) {
            push([each.clientX, each.clientY, each.pressure]);
          }
          if (!begun && Math.hypot(move.clientX - down.x, move.clientY - down.y) > TAP_SLACK)
            begin();
        };

        const onUp = (up: PointerEvent) => {
          if (up.pointerId !== id) return;
          if (!begun) {
            // Before `stop()`: it lets go of `held`, which says the click is ours to make.
            tap(up);
            stop();
            return;
          }
          done = true;
          if (start && penState().start === start) start.done = true;
          stop();
        };

        const onCancel = (cancel: PointerEvent) => {
          if (cancel.pointerId !== id) return;
          cancelled = true;
          const pending = penState().start;
          if (pending && (pending === start || (pending.key === null && pending.pointerId === id)))
            setPen({ start: null });
          stop();
        };

        function stop() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
          held = false;
          penDown = false;
        }

        /** A tap: the caret where it touched (Bearbeiten), a link followed. */
        const tap = (up: PointerEvent) => {
          const link = target.closest<HTMLAnchorElement>('a[href]');
          // The stylus's touch was held from the page: its click never comes, it is made here.
          if (link && held) {
            link.click();
            return;
          }
          if (!editor.isEditable()) return;
          const range = document.caretRangeFromPoint?.(up.clientX, up.clientY);
          if (!range) return;
          root.focus({ preventScroll: true });
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
      };

      root.addEventListener('touchstart', onTouch, { passive: false });
      root.addEventListener('touchmove', onTouch, { passive: false });
      root.addEventListener('pointerdown', onDown);
      return () => {
        root.removeEventListener('touchstart', onTouch);
        root.removeEventListener('touchmove', onTouch);
        root.removeEventListener('pointerdown', onDown);
      };
    }

    return () => {
      unroot();
      off();
    };
  }, [editor, canEdit]);

  return null;
}
