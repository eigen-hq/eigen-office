import { createContext, useContext, useEffect, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_PREFIX, linkPreviewPaths, type LinkPreview } from '@slider/shared';
import { api } from '@/lib/api-client';

/*
 * What Slider's server read of a web address (`services/link-previews.ts`): the page's title,
 * description, site, picture and its site's icon. Asked in the workspace the page is open in
 * (`LinkPreviewScope`, set once around the app); without one – signed out, a link from outside –
 * every address stays a plain link.
 */

const Scope = createContext<string | null>(null);

/** The workspace link previews are asked in; `null`: none (plain links). */
export const LinkPreviewScope = Scope.Provider;
export const useLinkScope = () => useContext(Scope);

/** An address written out as one – `https://…` / `http://…` –, not a bare `example.com`. */
export const WRITTEN_URL = /^https?:\/\/\S+$/i;

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * A line that is a web address and nothing else: its address and whether it was written in
 * pointy brackets (`<https://…>` – Markdown's way to say „a link, not a card“).
 */
export function loneUrl(line: string): { url: string; pointy: boolean } | null {
  const trimmed = line.trim();
  const pointy = /^<(https?:\/\/[^\s<>]+)>$/i.exec(trimmed);
  if (pointy) return { url: pointy[1]!, pointy: true };
  // Trailing punctuation belongs to a sentence, not to the address: such a line is no card. A `)`
  // closing a `(` in it is the address's own (`…/wiki/Foo_(Bar)`), as pages read it.
  const unclosed = trimmed.endsWith(')') && count(trimmed, '(') < count(trimmed, ')');
  if (WRITTEN_URL.test(trimmed) && !/[.,;:!?\]]$/.test(trimmed) && !unclosed) {
    return { url: trimmed, pointy: false };
  }
  return null;
}

/**
 * Written text's parts with `<https://…>` (Markdown's way to name an address) shown without its
 * brackets: the address alone, as its chip.
 */
export function withoutPointy<P extends { kind: string; text: string }>(parts: P[]): P[] {
  return parts.map((part, index) => {
    if (part.kind !== 'text') return part;
    let text = part.text;
    if (
      parts[index + 1]?.kind === 'url' &&
      text.endsWith('<') &&
      parts[index + 2]?.text.startsWith('>')
    ) {
      text = text.slice(0, -1);
    }
    if (
      parts[index - 1]?.kind === 'url' &&
      text.startsWith('>') &&
      parts[index - 2]?.text.endsWith('<')
    ) {
      text = text.slice(1);
    }
    return text === part.text ? part : { ...part, text };
  });
}

/** The card of an address, kept by address across the app; `null` when there is none. */
export function useLinkPreview(url: string | undefined, enabled = true) {
  const workspaceId = useLinkScope();
  const https = url && /^https:\/\//i.test(url) ? url : undefined;
  const query = useQuery({
    queryKey: ['link-preview', workspaceId, https],
    queryFn: () =>
      api
        .get<LinkPreview | undefined>(linkPreviewPaths.of(workspaceId!, https!))
        .then((found) => found ?? null),
    enabled: !!workspaceId && !!https && enabled,
    // No card (none found, or the hour's lookups used up): asked again after a while.
    staleTime: (state) => (state.state.data === null ? 10 * 60 * 1000 : Infinity),
    retry: false,
  });
  const preview = query.data ?? null;
  return {
    preview,
    /** Still being asked: a card's place is not given up yet. */
    pending: query.isPending && query.fetchStatus === 'fetching',
    image:
      preview?.image && workspaceId
        ? `${API_PREFIX}${linkPreviewPaths.image(workspaceId, preview.url)}`
        : null,
    icon:
      preview?.icon && workspaceId
        ? `${API_PREFIX}${linkPreviewPaths.icon(workspaceId, preview.url)}`
        : null,
  };
}

/**
 * Whether an element came near the screen once (200 px ahead): a link is asked for only then, so
 * a long page's many links do not use up the hour's lookups at once.
 */
export function useSeen(ref: RefObject<Element | null>): boolean {
  // Without an observer (an old browser, tests) everything counts as seen.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}
