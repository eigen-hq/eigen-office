import { $createLinkNode, $isLinkNode, type LinkNode } from '@lexical/link';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  type LexicalNode,
  type NodeKey,
} from 'lexical';
import {
  $createWebCardNode,
  $createWebChipNode,
  $isWebCardNode,
  $isWebChipNode,
  type WebChipNode,
} from './nodes';

/*
 * The three ways a web address stands on a page – Notion's „URL“, „Mention“, „Bookmark“:
 *
 * - `link`: words that lead there (`[Text](https://…)`, Lexical's `LinkNode`),
 * - `chip`: the site's icon and the page's title in the sentence (`WebChipNode`, `<https://…>`),
 * - `card`: the page's card on a line of its own (`WebCardNode`, `https://…` alone).
 *
 * All three are plain Markdown: elsewhere the file shows a link each time.
 */

export type WebLook = 'link' | 'chip' | 'card';

export interface WebTarget {
  look: WebLook;
  key: NodeKey;
  url: string;
}

const WEB = /^https?:\/\//i;

/** What the selection is on: one picked chip or card, or the caret in a link's words. */
export function $webTargetOf(selection: BaseSelection | null): WebTarget | null {
  if ($isNodeSelection(selection)) {
    const nodes = selection.getNodes();
    const node = nodes.length === 1 ? nodes[0] : null;
    if ($isWebChipNode(node)) return { look: 'chip', key: node.getKey(), url: node.getUrl() };
    if ($isWebCardNode(node)) return { look: 'card', key: node.getKey(), url: node.getUrl() };
    return null;
  }
  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    let node: LexicalNode | null = selection.anchor.getNode();
    while (node && !$isLinkNode(node)) node = node.getParent();
    if ($isLinkNode(node) && node.getType() === 'link' && WEB.test(node.getURL())) {
      return { look: 'link', key: node.getKey(), url: node.getURL() };
    }
  }
  return null;
}

const pickNode = (node: LexicalNode) => {
  const selection = $createNodeSelection();
  selection.add(node.getKey());
  $setSelection(selection);
};

/** The block a node stands in, at the page's top (a paragraph, a list's item's list …). */
const blockOf = (node: LexicalNode) => node.getTopLevelElement() ?? node;

/** `node` (in a sentence) taken out, its card put under the block it stood in. */
function $cardInstead(node: WebChipNode | LinkNode, url: string) {
  const parent = node.getParent();
  const card = $createWebCardNode(url);
  if (
    parent &&
    $isElementNode(parent) &&
    parent.getChildrenSize() === 1 &&
    parent.is(blockOf(node)) &&
    parent.getType() === 'paragraph'
  ) {
    parent.replace(card);
  } else {
    blockOf(node).insertAfter(card);
    node.remove();
  }
  pickNode(card);
}

/** The words a chip or card becomes as a link: the page's title, else the address. */
function $linkOf(url: string, title: string | null): LinkNode {
  return $createLinkNode(url).append($createTextNode(title ?? url));
}

/**
 * The address shown the other way (inside `editor.update`); what is made is picked – a link with
 * the caret at its end – so the bar stays over it. `title`: the page's, for a link's words.
 */
export function $setWebLook(target: WebTarget, look: WebLook, title: string | null) {
  const node = $getNodeByKey(target.key);
  if (!node || look === target.look) return;
  const { url } = target;
  if ($isWebChipNode(node)) {
    if (look === 'card') return $cardInstead(node, url);
    const link = $linkOf(url, title);
    node.replace(link);
    link.selectEnd();
    return;
  }
  if ($isWebCardNode(node)) {
    const paragraph = $createParagraphNode();
    node.replace(paragraph);
    if (look === 'chip') {
      const chip = $createWebChipNode(url, true);
      paragraph.append(chip);
      pickNode(chip);
    } else {
      const link = $linkOf(url, title);
      paragraph.append(link);
      link.selectEnd();
    }
    return;
  }
  if ($isLinkNode(node)) {
    if (look === 'card') return $cardInstead(node, url);
    const chip = $createWebChipNode(url);
    node.replace(chip);
    pickNode(chip);
  }
}

/**
 * A web address put in (⌘V of an address and nothing else): over picked words a link of them, on
 * an empty line its card, in a sentence its chip. `false`: not such a paste – the editor's own.
 */
export function $pasteWebAddress(selection: BaseSelection | null, url: string): boolean {
  if (!$isRangeSelection(selection)) return false;
  if (!selection.isCollapsed()) {
    if (!selection.getTextContent().trim()) return false;
    const words = selection.extract();
    const link = $createLinkNode(url);
    const first = words[0];
    if (!first) return false;
    first.insertBefore(link);
    for (const word of words) link.append(word);
    link.selectEnd();
    return true;
  }
  const anchor = selection.anchor.getNode();
  const block = anchor.getTopLevelElement();
  if (block && block.getType() === 'paragraph' && block.getTextContentSize() === 0) {
    const card = $createWebCardNode(url);
    block.replace(card);
    const next = card.getNextSibling();
    if (next) next.selectStart();
    else card.insertAfter($createParagraphNode()).selectStart();
    return true;
  }
  const chip = $createWebChipNode(url);
  selection.insertNodes([chip]);
  return true;
}
