import { useMemo } from 'react';
import { LinkCard, LinkChip } from '@/lib/links';
import { cn } from '@/ui';
import { tokenizeBody, type BodyToken } from './lib/comment-body';
import { useMentionPeople } from './mention-people';

interface CommentBodyProps {
  body: string;
  className?: string;
}

/** A link token alone on its line: its card; the line break after it is the card's own. */
function withCards(tokens: BodyToken[]): (BodyToken | { type: 'card'; href: string })[] {
  const out: (BodyToken | { type: 'card'; href: string })[] = [];
  tokens.forEach((token, index) => {
    const before = tokens[index - 1];
    const after = tokens[index + 1];
    const last = out.at(-1);
    if (
      token.type === 'link' &&
      (!before || (before.type === 'text' && before.text.endsWith('\n'))) &&
      (!after || (after.type === 'text' && after.text.startsWith('\n')))
    ) {
      out.push({ type: 'card', href: token.href });
      return;
    }
    if (token.type === 'text' && last?.type === 'card') {
      if (token.text.length > 1) out.push({ type: 'text', text: token.text.slice(1) });
      return;
    }
    out.push(token);
  });
  return out;
}

/**
 * Renders a comment body with @mentions, **bold** and links as React nodes (no HTML injection):
 * an address in a sentence its chip, one on a line of its own its card (`lib/links`).
 */
export function CommentBody({ body, className }: CommentBodyProps) {
  const { participantNames, myName } = useMentionPeople();
  const ownMention = `@${myName}`;
  const tokens = useMemo(
    () => withCards(tokenizeBody(body, participantNames)),
    [body, participantNames],
  );

  return (
    <p className={cn('text-body leading-4.5 break-words whitespace-pre-wrap text-fg', className)}>
      {tokens.map((token, index) => {
        switch (token.type) {
          case 'text':
            return token.text;
          case 'bold':
            return (
              <strong key={index} className="font-semibold text-fg">
                {token.text}
              </strong>
            );
          case 'mention':
            // The viewer's own name stands out (BER-105).
            return (
              <span
                key={index}
                className={cn(
                  'font-medium text-mention',
                  token.text === ownMention && 'rounded-thumb bg-mention/20 px-0.5 text-fg',
                )}
              >
                {token.text}
              </span>
            );
          case 'link':
            return <LinkChip key={index} url={token.href} className="relative z-(--z-raised)" />;
          case 'card':
            return (
              <LinkCard
                key={index}
                url={token.href}
                className="relative z-(--z-raised) my-1"
                fallback={<LinkChip url={token.href} className="relative z-(--z-raised)" />}
              />
            );
        }
      })}
    </p>
  );
}
