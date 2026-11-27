import { Fragment, type ReactNode } from 'react';
import { LinkCard, LinkChip } from '@/lib/links';
import { cn } from '@/ui';
import { RICH_THEME as THEME } from './rich-theme';

/*
 * Rich text shown without its editor (the chat's answers): Lexical's serialised state walked into
 * elements – safe by construction, links only http(s). A bare address (a link whose words are its
 * address) is its chip, alone in a paragraph its card; named links stay words (`lib/links`).
 */

type Serialized = {
  type?: string;
  children?: Serialized[];
  text?: string;
  format?: number;
  tag?: string;
  listType?: string;
  url?: string;
};

/** Lexical's format bits. */
const BOLD = 1;
const ITALIC = 2;
const STRIKE = 4;
const UNDERLINE = 8;

/** A sticker's rich text shown (no editor): its state walked into elements, safe by construction. */
export function RichText({
  rich,
  className,
  renderText = plain,
}: {
  rich: Record<string, unknown>;
  className?: string;
  /** A text run's content – the material answers turn their sources into chips. */
  renderText?: (text: string) => ReactNode;
}) {
  const root = (rich as { root?: Serialized }).root;
  return <div className={className}>{render(root?.children ?? [], renderText)}</div>;
}

const plain = (text: string) => text;

const WEB = /^https?:\/\//i;

/** A link whose words are its own address – written bare, not named. */
function bareUrl(node: Serialized | undefined): string | null {
  if (!node || (node.type !== 'link' && node.type !== 'autolink')) return null;
  const url = node.url ?? '';
  if (!WEB.test(url)) return null;
  const words = (node.children ?? []).map((child) => child.text ?? '').join('');
  return words === url || words === url.replace(/^https?:\/\//i, '') ? url : null;
}

function render(nodes: Serialized[], text: (text: string) => ReactNode): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node, text)}</Fragment>);
}

function renderNode(node: Serialized, text: (text: string) => ReactNode): ReactNode {
  const children = render(node.children ?? [], text);
  switch (node.type) {
    case 'text': {
      const bits = node.format ?? 0;
      return (
        <span
          className={cn(
            bits & BOLD && THEME.text.bold,
            bits & ITALIC && THEME.text.italic,
            bits & UNDERLINE && !(bits & STRIKE) && THEME.text.underline,
            bits & STRIKE && !(bits & UNDERLINE) && THEME.text.strikethrough,
            bits & UNDERLINE && bits & STRIKE && THEME.text.underlineStrikethrough,
          )}
        >
          {text(node.text ?? '')}
        </span>
      );
    }
    case 'linebreak':
      return <br />;
    case 'link':
    case 'autolink': {
      const bare = bareUrl(node);
      if (bare) return <LinkChip url={bare} className="nodrag" />;
      return WEB.test(node.url ?? '') ? (
        <a
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(THEME.link, 'nodrag')}
        >
          {children}
        </a>
      ) : (
        children
      );
    }
    case 'heading':
      return node.tag === 'h1' ? (
        <p className={THEME.heading.h1}>{children}</p>
      ) : (
        <p className={THEME.heading.h2}>{children}</p>
      );
    case 'list':
      return node.listType === 'number' ? (
        <ol className={THEME.list.ol}>{children}</ol>
      ) : (
        <ul className={THEME.list.ul}>{children}</ul>
      );
    case 'listitem':
      return <li className={THEME.list.listitem}>{children}</li>;
    default: {
      const lone = node.children?.length === 1 ? bareUrl(node.children[0]) : null;
      if (lone) {
        return (
          <div className={cn(THEME.paragraph, 'py-0.5')}>
            <LinkCard url={lone} className="nodrag" fallback={<LinkChip url={lone} />} />
          </div>
        );
      }
      return <p className={THEME.paragraph}>{node.children?.length ? children : <br />}</p>;
    }
  }
}
