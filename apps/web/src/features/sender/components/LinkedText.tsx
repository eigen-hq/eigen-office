import { useMemo, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMailAccounts } from '@/lib/api';
import { draftFor, draftKeys, setDraft } from '@/lib/drafts';
import { LinkChip, TEXT_LINK_CLASS, withoutPointy, WRITTEN_URL } from '@/lib/links';
import { linkify, shortUrl } from '@/lib/linkify';
import { useSender } from '../hooks/useSender';
import { NEW_MAIL } from '../lib/mail';

/** A plain click – not one that asks for a new tab or a copy of the link. */
const plain = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * Written text with what can be opened in it as links (`linkify`): web addresses in a new tab
 * (a long one shortened to its host and the start of its path, the whole in its tooltip), phone
 * numbers to call (`tel:`), mail addresses to write to – here, in „Neue Mail“ with the address
 * in „An“, where the workspace has a mailbox (else, and with ⌘ or a middle click, `mailto:`).
 * `chips`: an address written out (`https://…`) is a chip – its site's icon and the page's title
 * (`LinkChip`), as in every text people write here; a received mail's addresses stay as written
 * (its links are never read by the server: one may sign in or unsubscribe).
 */
export function LinkedText({ text, chips = false }: { text: string; chips?: boolean }) {
  const ui = useSender();
  const navigate = useNavigate();
  const mailboxes = useMailAccounts(ui.workspace.id).data ?? [];
  const parts = useMemo(
    () => (chips ? withoutPointy(linkify(text)) : linkify(text)),
    [text, chips],
  );
  const writeTo = (event: MouseEvent, address: string) => {
    if (mailboxes.length === 0 || !plain(event)) return;
    event.preventDefault();
    const key = draftKeys.newMail(ui.workspace.id);
    const kept = draftFor(key);
    const target = kept?.target?.kind === 'mail-new' ? kept.target : null;
    const others = (target?.to ?? '').split(/[\s,;]+/).filter(Boolean);
    const to = others.includes(address) ? others : [...others, address];
    setDraft(key, kept?.text ?? '', {
      kind: 'mail-new',
      workspaceId: ui.workspace.id,
      accountId: target?.accountId ?? '',
      to: to.join(', '),
      subject: target?.subject ?? '',
    });
    void navigate(ui.mailThreadPath(NEW_MAIL));
  };
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'text') return part.text;
        if (chips && part.kind === 'url' && WRITTEN_URL.test(part.text)) {
          return <LinkChip key={index} url={part.href} />;
        }
        const shown = part.kind === 'url' ? shortUrl(part.text) : part.text;
        return (
          <a
            key={index}
            href={part.href}
            title={shown === part.text ? undefined : part.href}
            // A number reads whole: never broken between its groups.
            className={
              part.kind === 'phone' ? `${TEXT_LINK_CLASS} whitespace-nowrap` : TEXT_LINK_CLASS
            }
            {...(part.kind === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            onClick={
              part.kind === 'email'
                ? (event) => writeTo(event, part.href.replace(/^mailto:/i, ''))
                : undefined
            }
          >
            {shown}
          </a>
        );
      })}
    </>
  );
}
