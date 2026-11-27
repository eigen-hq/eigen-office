import { Fragment, useMemo, type ReactNode } from 'react';
import { linkify } from '@/lib/linkify';
import { TEXT_LINK_CLASS } from './classes';
import { LinkCard } from './LinkCard';
import { LinkChip } from './LinkChip';
import { loneUrl, withoutPointy, WRITTEN_URL } from './preview';

/**
 * One line's words with what opens from them: an address written out (`https://…`) as a chip
 * (`LinkChip`), a bare one (`example.de`), a mail or a phone as a plain link. `link` lets the
 * caller draw mails its own way (Sender writes to them).
 */
export function LinkedWords({
  text,
  link,
}: {
  text: string;
  link?: (part: { kind: 'email' | 'phone' | 'url'; text: string; href: string }) => ReactNode;
}) {
  const parts = useMemo(() => withoutPointy(linkify(text)), [text]);
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'text') return <Fragment key={index}>{part.text}</Fragment>;
        if (part.kind === 'url' && WRITTEN_URL.test(part.text)) {
          return <LinkChip key={index} url={part.href} />;
        }
        const own = link?.(part);
        if (own) return <Fragment key={index}>{own}</Fragment>;
        return (
          <a
            key={index}
            href={part.href}
            className={
              part.kind === 'phone' ? `${TEXT_LINK_CLASS} whitespace-nowrap` : TEXT_LINK_CLASS
            }
            {...(part.kind === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {part.text}
          </a>
        );
      })}
    </>
  );
}

/**
 * Plain text people wrote (a to-do's note, a comment, a note) with its links, one way everywhere:
 * an address on a line of its own is a card (`LinkCard`, `<https://…>` there a chip), one in a
 * sentence a chip, `example.de`, mails and phones plain links. For a `whitespace-pre-wrap` box:
 * the text's line breaks stay, the one after a card is the card's own.
 */
export function WebText({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const out: ReactNode[] = [];
  lines.forEach((line, index) => {
    const lone = loneUrl(line);
    if (lone && !lone.pointy) {
      out.push(
        <LinkCard
          key={index}
          url={lone.url}
          className="my-1"
          fallback={
            <>
              <LinkChip url={lone.url} />
              {index < lines.length - 1 && '\n'}
            </>
          }
        />,
      );
      return;
    }
    out.push(
      <Fragment key={index}>
        {lone ? <LinkChip url={lone.url} /> : <LinkedWords text={line} />}
        {index < lines.length - 1 && '\n'}
      </Fragment>,
    );
  });
  return <>{out}</>;
}
