import { CodeNode } from '@lexical/code-core';
import { $isLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import {
  CHECK_LIST,
  TRANSFORMERS,
  type ElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from '@lexical/markdown';
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/react/LexicalHorizontalRuleNode';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $createTextNode, type Klass, type LexicalNode } from 'lexical';
import {
  $createDiagramEmbedNode,
  $createLiveBlockNode,
  $createPageLinkNode,
  $isCalloutNode,
  $isDiagramEmbedNode,
  $isLiveBlockNode,
  $isPageLinkNode,
  $isRawBlockNode,
  $createWebCardNode,
  $createWebChipNode,
  $isWebCardNode,
  $isWebChipNode,
  WEB_URL,
  CalloutNode,
  DiagramEmbedNode,
  isLiveKind,
  LiveBlockNode,
  PageLinkNode,
  RawBlockNode,
  WebCardNode,
  WebChipNode,
  type PageLinkKind,
} from './nodes';

/** Every node a page holds. */
export const PAGE_NODES: Klass<LexicalNode>[] = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  HorizontalRuleNode,
  PageLinkNode,
  LiveBlockNode,
  DiagramEmbedNode,
  RawBlockNode,
  CalloutNode,
  WebChipNode,
  WebCardNode,
];

/** `[[file:id|Name]]` – as the agents write a file into their answers (`cloud/lib/named.ts`). */
const PAGE_LINK = /\[\[(file|folder|area|presentation):([0-9a-f-]{36})\|([^\]\n}]+)\]\]/;

export const PAGE_LINK_TRANSFORMER: TextMatchTransformer = {
  type: 'text-match',
  dependencies: [PageLinkNode],
  export: (node) => ($isPageLinkNode(node) ? node.markdown() : null),
  importRegExp: PAGE_LINK,
  regExp: new RegExp(`${PAGE_LINK.source}$`),
  trigger: ']',
  replace: (textNode, match) => {
    textNode.replace($createPageLinkNode(match[1] as PageLinkKind, match[2]!, match[3]!.trim()));
  },
};

/**
 * A web address alone on its line: its card. Typed it becomes a chip (`WEB_CHIP_TRANSFORMER`) –
 * one may write on after it –; a card comes from ⌘V on an empty line or the bar (`WebLinkBar`).
 */
export const WEB_CARD_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [WebCardNode],
  export: (node) => ($isWebCardNode(node) ? node.markdown() : null),
  regExp: new RegExp(`^(${WEB_URL})$`),
  replace: (parentNode, _children, match) => {
    parentNode.replace($createWebCardNode(match[1]!));
  },
};

/**
 * A web address in a sentence (`https://…`, or `<https://…>`): its chip. Typed, it becomes one at
 * the space after it. Never inside a link's words (`[https://…](…)` stays that link).
 */
export const WEB_CHIP_TRANSFORMER: TextMatchTransformer = {
  type: 'text-match',
  dependencies: [WebChipNode],
  export: (node) => ($isWebChipNode(node) ? node.markdown() : null),
  importRegExp: new RegExp(`<(https?:\\/\\/[^\\s<>]+)>|(${WEB_URL})`),
  regExp: new RegExp(`(?:<(https?:\\/\\/[^\\s<>]+)>|(${WEB_URL})) $`),
  trigger: ' ',
  getEndIndex: (node, match) =>
    $isLinkNode(node.getParent()) ? false : (match.index ?? 0) + match[0].length,
  replace: (textNode, match) => {
    if ($isLinkNode(textNode.getParent())) return;
    const chip = $createWebChipNode(match[1] ?? match[2]!, !!match[1]);
    textNode.replace(chip);
    // Typed: the space that made it stays after it, the caret behind the space.
    if (match[0].endsWith(' ')) {
      const space = $createTextNode(' ');
      chip.insertAfter(space);
      space.select(1, 1);
    }
  },
};

const RULE_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const rule = $createHorizontalRuleNode();
    if (isImport) {
      parentNode.replace(rule);
      return;
    }
    if (parentNode.getNextSibling() != null) parentNode.replace(rule);
    else parentNode.insertBefore(rule);
    rule.selectNext();
  },
};

const LIVE_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [LiveBlockNode],
  export: (node) => ($isLiveBlockNode(node) ? node.markdown() : null),
  regExp: /^\{\{\s*([a-zäöü]+)\s*\}\}\s?$/,
  replace: (parentNode, _children, match) => {
    const kind = match[1] ?? '';
    if (!isLiveKind(kind)) return false;
    parentNode.replace($createLiveBlockNode(kind));
  },
};

/** A diagram's link alone on its line: the diagram, drawn. Anywhere else it stays a link. */
const DIAGRAM_EMBED_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [DiagramEmbedNode],
  export: (node) => ($isDiagramEmbedNode(node) ? node.markdown() : null),
  regExp: /^\[\[file:([0-9a-f-]{36})\|([^\]\n}]+\.diagram)\]\]\s?$/,
  replace: (parentNode, _children, match) => {
    parentNode.replace($createDiagramEmbedNode(match[1]!, match[2]!));
  },
};

/** Never read from Markdown (`codec.ts` makes them), only written back as they stand. */
const RAW_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [RawBlockNode],
  export: (node) => ($isRawBlockNode(node) ? node.markdown() : null),
  regExp: /(?!)/,
  replace: () => false,
};

const CALLOUT_TRANSFORMER: ElementTransformer = {
  type: 'element',
  dependencies: [CalloutNode],
  export: (node, children) => {
    if (!$isCalloutNode(node)) return null;
    const body = children(node)
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'));
    return [`> [!${node.getTone()}]`, ...body].join('\n');
  },
  regExp: /(?!)/,
  replace: () => false,
};

/** What a page reads and writes: its own blocks first, then Lexical's. */
export const PAGE_TRANSFORMERS: Transformer[] = [
  RAW_TRANSFORMER,
  CALLOUT_TRANSFORMER,
  DIAGRAM_EMBED_TRANSFORMER,
  LIVE_TRANSFORMER,
  RULE_TRANSFORMER,
  WEB_CARD_TRANSFORMER,
  CHECK_LIST,
  ...TRANSFORMERS,
  PAGE_LINK_TRANSFORMER,
  WEB_CHIP_TRANSFORMER,
];
