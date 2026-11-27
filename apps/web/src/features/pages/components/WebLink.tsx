import type { NodeKey } from 'lexical';
import type { MouseEvent } from 'react';
import { LinkCard, LinkChip } from '@/lib/links';
import { cn } from '@/ui';
import { useBlockPick } from './useBlockPick';

/** A plain click – not one that asks for a new tab or a copy of the link. */
const plain = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * A web address in a sentence on the page: its chip (`LinkChip`). In Lesen a click opens it; in
 * Bearbeiten a click picks it – the bar over it switches between link, chip and card
 * (`WebLinkBar`), ⌫ takes it out –, ⌘-click opens it.
 */
export function WebChipView({ url, nodeKey }: { url: string; nodeKey: NodeKey }) {
  const { editable, picked, pick } = useBlockPick(nodeKey);
  return (
    <LinkChip
      url={url}
      editable={editable}
      className={cn(picked && 'page-picked')}
      onClick={(event) => {
        if (!editable || !plain(event)) return;
        event.preventDefault();
        pick(event);
      }}
    />
  );
}

/**
 * A web address alone on its line: its card (`LinkCard`), Notion's bookmark – a chip where the
 * page has none (no title, not reached). Picked and opened as the chip is.
 */
export function WebCardView({ url, nodeKey }: { url: string; nodeKey: NodeKey }) {
  const { editable, picked, pick } = useBlockPick(nodeKey);
  return (
    <div
      className={cn('page-web-card', picked && 'page-picked')}
      onClickCapture={(event) => {
        if (!editable || !plain(event)) return;
        event.preventDefault();
        event.stopPropagation();
        pick(event);
      }}
    >
      <LinkCard url={url} fallback={<LinkChip url={url} editable={editable} />} />
    </div>
  );
}
