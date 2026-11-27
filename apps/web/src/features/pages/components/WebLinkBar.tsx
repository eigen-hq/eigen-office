import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
import { useQueryClient } from '@tanstack/react-query';
import type { LinkPreview } from '@slider/shared';
import {
  $getSelection,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLinkScope, WRITTEN_URL } from '@/lib/links';
import { SegmentedControl } from '@/ui';
import {
  $pasteWebAddress,
  $setWebLook,
  $webTargetOf,
  type WebLook,
  type WebTarget,
} from '../lib/web-links';

/** How far above the address the bar floats. */
const GAP = 8;
/** How near the window's edge it may come. */
const EDGE = 8;

const LOOKS = [
  { value: 'link', label: 'Link', title: 'Als Wörter, die dorthin führen' },
  { value: 'chip', label: 'Erwähnung', title: 'Symbol und Titel der Seite im Satz' },
  { value: 'card', label: 'Karte', title: 'Die Karte der Seite auf eigener Zeile' },
] as const satisfies readonly { value: WebLook; label: string; title: string }[];

/**
 * Web addresses on a page in Bearbeiten, as Notion handles them: ⌘V of an address makes a link of
 * the picked words, a card on an empty line, a chip in a sentence; a picked chip or card, or the
 * caret in a link, shows this bar over it – „Link | Erwähnung | Karte“, one always picked – to
 * show the address the other way. Nothing opens over the page beyond it; Esc goes on as ever.
 */
export function WebLinkBar() {
  const [editor] = useLexicalComposerContext();
  const queryClient = useQueryClient();
  const workspaceId = useLinkScope();
  const [target, setTarget] = useState<WebTarget | null>(null);
  const [at, setAt] = useState<{ key: string; left: number; top: number } | null>(null);

  useEffect(() => {
    const follow = () =>
      editor.getEditorState().read(() => {
        const found = editor.isEditable() ? $webTargetOf($getSelection()) : null;
        setTarget((was) =>
          was?.key === found?.key && was?.look === found?.look && was?.url === found?.url
            ? was
            : found,
        );
      });
    return mergeRegister(
      editor.registerUpdateListener(follow),
      editor.registerEditableListener(follow),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          follow();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          const data = event instanceof ClipboardEvent ? event.clipboardData : null;
          const text = data?.getData('text/plain').trim() ?? '';
          if (!WRITTEN_URL.test(text) || data?.files.length) return false;
          const done = $pasteWebAddress($getSelection(), text);
          if (done) event.preventDefault();
          return done;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  // Placed over the address, kept there as the page scrolls.
  useEffect(() => {
    if (!target) return;
    const place = () => {
      const element = editor.getElementByKey(target.key);
      const box = (element?.firstElementChild ?? element)?.getBoundingClientRect();
      if (!box || (box.width === 0 && box.height === 0)) return setAt(null);
      setAt({ key: target.key, left: box.left + Math.min(box.width, 448) / 2, top: box.top - GAP });
    };
    // Once the address is drawn where it now stands.
    const frame = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [editor, target]);

  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element || !at) return;
    const half = element.offsetWidth / 2 + EDGE;
    element.style.left = `${Math.min(Math.max(at.left, half), window.innerWidth - half)}px`;
  }, [at]);

  if (!target || !at || at.key !== target.key) return null;
  const choose = (look: WebLook) => {
    const title =
      queryClient.getQueryData<LinkPreview | null>(['link-preview', workspaceId, target.url])
        ?.title ?? null;
    editor.update(() => $setWebLook(target, look, title));
    editor.focus();
  };
  return createPortal(
    <div
      ref={bar}
      data-popover-panel=""
      className="glass-elevated fixed z-(--z-raised) rounded-panel p-1"
      style={{ left: at.left, top: at.top, transform: 'translate(-50%, -100%)' }}
      // The page keeps its selection: the bar is pressed, not focused into.
      onMouseDown={(event) => event.preventDefault()}
    >
      <SegmentedControl
        segments={LOOKS}
        value={target.look}
        onChange={choose}
        label="Link zeigen als"
        size="sm"
      />
    </div>,
    document.body,
  );
}
