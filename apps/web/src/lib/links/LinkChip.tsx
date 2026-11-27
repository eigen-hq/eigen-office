import { useRef, useState, type MouseEvent } from 'react';
import { cn, Icon } from '@/ui';
import { shortUrl } from '@/lib/linkify';
import { CHIP_CLASS } from './classes';
import { useLinkPreview, useSeen } from './preview';

/**
 * A web address in running text as Notion mentions a page: its site's icon and the page's own
 * title, a link opening the address in a new tab (the whole address in its tooltip). Until the
 * server has read the page – or where it may not (no title, refused, signed out) – the address
 * itself, shortened, beside a link icon.
 */
export function LinkChip({
  url,
  className,
  onClick,
  editable,
}: {
  url: string;
  className?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** In an editor: not to be typed into, never dragged as a link. */
  editable?: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const seen = useSeen(ref);
  const { preview, icon } = useLinkPreview(url, seen);
  const [iconFailed, setIconFailed] = useState(false);
  return (
    <a
      ref={ref}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className={cn(CHIP_CLASS, className)}
      onClick={onClick}
      contentEditable={editable ? false : undefined}
      draggable={false}
    >
      {icon && !iconFailed ? (
        <img
          src={icon}
          alt=""
          draggable={false}
          onError={() => setIconFailed(true)}
          className="size-[1.05em] shrink-0 self-center rounded-[3px] object-contain"
        />
      ) : (
        <Icon name="link" size={16} className="shrink-0 self-center text-fg-subtle" />
      )}
      <span className="min-w-0 truncate">{preview?.title ?? shortUrl(url)}</span>
    </a>
  );
}
