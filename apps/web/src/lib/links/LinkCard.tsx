import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/ui';
import { useLinkPreview, useSeen } from './preview';

/**
 * A web address on a line of its own as a card – Notion's bookmark: the page's picture, its
 * site's icon and name, title and description, what Slider's server read of it. The whole card
 * opens the address as written, in a new tab. A page without a title, one the server may not read
 * or not reached shows `fallback` (the address as a link) instead.
 */
export function LinkCard({
  url,
  fallback,
  className,
}: {
  url: string;
  fallback?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref);
  const { preview: card, image, icon } = useLinkPreview(url, seen);
  const [pictureFailed, setPictureFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  if (!card) {
    return (
      // Inline, not `contents`: a box without one is never seen coming near the screen.
      <span ref={ref}>{fallback ?? null}</span>
    );
  }
  const picture = image && !pictureFailed ? image : null;
  // A logo or an avatar beside the words; only a wide picture fills the banner.
  const small = card.image === 'small';
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      draggable={false}
      className={cn(
        'group/card flex w-full max-w-md min-w-0 flex-col overflow-hidden rounded-control bg-surface-1 whitespace-normal no-underline ring-hairline transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
        className,
      )}
    >
      {picture && !small && (
        <img
          src={picture}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setPictureFailed(true)}
          // The common shape of a page's picture (1200 × 630): its room held before it loads.
          className="block aspect-[1.91] w-full bg-surface-2 object-cover"
        />
      )}
      <span className="flex min-w-0 items-center gap-3 px-3 py-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-caption text-fg-subtle">
            {icon && !iconFailed && (
              <img
                src={icon}
                alt=""
                draggable={false}
                onError={() => setIconFailed(true)}
                className="size-3.5 shrink-0 rounded-[3px] object-contain"
              />
            )}
            <span className="truncate">{card.site}</span>
          </span>
          <span className="line-clamp-2 text-body font-medium text-fg group-hover/card:underline">
            {card.title}
          </span>
          {card.description && (
            <span className="line-clamp-2 text-xs text-fg-muted">{card.description}</span>
          )}
        </span>
        {picture && small && (
          <img
            src={picture}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setPictureFailed(true)}
            className="size-16 shrink-0 rounded-thumb bg-surface-2 object-cover"
          />
        )}
      </span>
    </a>
  );
}
