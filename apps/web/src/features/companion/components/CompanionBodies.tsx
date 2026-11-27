import type { Author, CalendarEvent, CompanionView, Workspace } from '@slider/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  fetchDocumentComments,
  fetchPdfComments,
  useCalendars,
  useCloudNode,
  useComments,
  useMailThread,
  useRemoveSenderAgent,
  useSenderMessages,
  useSlides,
  writerKeys,
} from '@/lib/api';
import { api } from '@/lib/api-client';
import { useCallHere } from '@/lib/call-here';
import { CLOUD_EVENT_PARAM } from '@/lib/routes';
import {
  ActivityFeed,
  AsidePart,
  at,
  CalendarAside,
  clock,
  dayFormat,
  FileIcon,
  hasPagePreview,
  MyTodos,
  PagePreview,
  todayNoon,
  UpcomingEvents,
  useBusyDays,
  useCalendarSource,
  useHiddenCalendars,
} from '@/features/cloud';
import { SlideThumbnail } from '@/features/reviews';
import { ChatAgents, MailAside, useSenderOrNull } from '@/features/sender';
import { buildThreads, CommentPreview } from '@/features/viewer';
import { Avatar, Icon, type ShowToast } from '@/ui';
import { useCompanionTitle } from '../lib/title';

/*
 * What the phone beside the computer shows for each kind of page there – the column one has
 * beside it on the computer, where there is one („KI zur Mail“, the calendar's), else what goes
 * with it: the slide's comments, the document's, the file's details, today.
 */

/** Comments change on the computer while one looks: read again now and then. */
const AGAIN_MS = 15_000;

interface BodyProps {
  view: CompanionView;
  workspace: Workspace;
  notify: ShowToast;
}

/** Kinds whose column asks its own agent at its foot („Nachfragen“): no second field below. */
export const ASKS_ITSELF: ReadonlySet<CompanionView['kind']> = new Set(['mail', 'calendar']);

export function CompanionBody(props: BodyProps) {
  const { view } = props;
  switch (view.kind) {
    case 'mail':
      return view.id ? <MailBody {...props} id={view.id} /> : <TodayBody />;
    case 'chat':
      return view.id ? <ChatBody {...props} id={view.id} /> : <TodayBody />;
    case 'calendar':
      return <CalendarBody {...props} />;
    case 'file':
      return view.id ? <FileBody {...props} id={view.id} /> : <TodayBody />;
    case 'deck':
      return view.id ? <DeckBody id={view.id} slideId={view.sub} /> : <TodayBody />;
    case 'document':
      return view.id ? <DocumentBody id={view.id} /> : <TodayBody />;
    case 'pdf':
      return view.id ? <PdfBody id={view.id} /> : <TodayBody />;
    default:
      return <TodayBody />;
  }
}

/** A column of parts, as beside a mail on the computer. */
function Column({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6 px-4 py-4">{children}</div>;
}

function Failed({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-body text-fg-muted">{children}</p>;
}

/* ---------- Mail: „KI zur Mail“ ---------- */

function MailBody({ workspace, id, notify }: BodyProps & { id: string }) {
  const thread = useMailThread(workspace.id, id);
  // Its last part asks Sender (the agent beside the mail): there once `/me` came.
  const sender = useSenderOrNull();
  useCallHere('companion-mail', thread.data ? `Mail: ${thread.data.subject}` : null);
  useCompanionTitle(thread.data?.subject);
  if (thread.isPending || !sender) return null;
  if (thread.isError) return <Failed>Die Mail konnte nicht geladen werden.</Failed>;
  return (
    // Its subject stands in the companion's heading (`useCompanionTitle`).
    <div className="flex min-h-full flex-col px-4 pt-4">
      <MailAside thread={thread.data} workspaceId={workspace.id} notify={notify} />
    </div>
  );
}

/* ---------- Chat: its agents ---------- */

function ChatBody({ workspace, id }: BodyProps & { id: string }) {
  const messages = useSenderMessages(workspace.id, id);
  const sender = useSenderOrNull();
  const remove = useRemoveSenderAgent(workspace.id, id);
  const channel = messages.data?.pages[0]?.channel;
  useCompanionTitle(channel?.name);
  if (messages.isPending || !sender) return null;
  if (!channel) return <Failed>Die Unterhaltung konnte nicht geladen werden.</Failed>;
  return (
    <Column>
      <ChatAgents channel={channel} add={null} onRemove={(agent) => remove.mutate(agent.id)} />
    </Column>
  );
}

/* ---------- Kalender: its column, the event open there ---------- */

function CalendarBody({ view, workspace }: BodyProps) {
  const day = view.sub && /^\d{4}-\d{2}-\d{2}$/.test(view.sub) ? at(view.sub) : todayNoon();
  const calendars = useCalendars(workspace.id);
  const { hidden, toggle } = useHiddenCalendars(workspace.id);
  const source = useCalendarSource(calendars.data);
  const busy = useBusyDays(workspace.id, day, true, source);
  const [, setParams] = useSearchParams();
  return (
    <div className="flex min-h-full flex-col gap-4 px-4 pt-4">
      {view.id && <EventCard id={view.id} />}
      <CalendarAside
        anchor={day}
        // A day picked opens its agenda here (`EventPanel`), not on the computer.
        onPick={(picked) => setParams({ [CLOUD_EVENT_PARAM]: 'tag', am: picked })}
        busy={busy}
        calendars={calendars.data}
        hidden={hidden}
        source={source}
        onToggle={toggle}
      />
    </div>
  );
}

const eventWhen = (event: CalendarEvent) => {
  if (event.allDay) return `${dayFormat.format(at(event.start))} | ganztägig`;
  const start = new Date(event.start);
  return `${dayFormat.format(start)} | ${clock(start)}–${clock(new Date(event.end))}`;
};

function EventCard({ id }: { id: string }) {
  const event = useQuery({
    queryKey: ['companion', 'event', id],
    queryFn: () => api.get<CalendarEvent>(`/calendar-events/${encodeURIComponent(id)}`),
  });
  const [, setParams] = useSearchParams();
  useCompanionTitle(event.data?.title);
  useCallHere(
    'companion-event',
    event.data ? `Termin: ${event.data.title}, ${eventWhen(event.data)}` : null,
  );
  if (!event.data) return null;
  return (
    <div>
      <AsidePart label="Termin" icon="event">
        <button
          type="button"
          onClick={() => setParams({ [CLOUD_EVENT_PARAM]: id })}
          className="flex w-full flex-col gap-1 rounded-control bg-surface-1 px-3 py-2.5 text-left hover:bg-hover"
        >
          <span className="text-body font-semibold text-fg">{event.data.title}</span>
          <span className="text-caption text-fg-muted">{eventWhen(event.data)}</span>
          {event.data.location && (
            <span className="text-caption text-fg-muted">{event.data.location}</span>
          )}
        </button>
      </AsidePart>
    </div>
  );
}

/* ---------- Datei: its details ---------- */

function FileBody({ workspace, id }: BodyProps & { id: string }) {
  const detail = useCloudNode(workspace.id, id);
  useCompanionTitle(detail.data?.node.name);
  useCallHere(
    'companion-file',
    detail.data ? `Datei: ${detail.data.path.map((step) => step.name).join(' / ')}` : null,
  );
  if (detail.isPending) return null;
  if (detail.isError) return <Failed>Die Datei konnte nicht geladen werden.</Failed>;
  const { node, path, events } = detail.data;
  return (
    <Column>
      <div className="flex min-w-0 items-center gap-3">
        <FileIcon kind={node.kind} type={node.fileType} size={32} />
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-fg">{node.name}</h2>
          {path.length > 1 && (
            <p className="truncate text-caption text-fg-muted">
              {path
                .slice(0, -1)
                .map((step) => step.name)
                .join(' / ')}
            </p>
          )}
        </div>
      </div>
      {hasPagePreview(node) && <PagePreview key={`${node.id}-${node.versionId}`} node={node} />}
      <AsidePart label="Verlauf" icon="schedule">
        <ActivityFeed events={events} compact />
      </AsidePart>
    </Column>
  );
}

/* ---------- Präsentation: the slide, its comments ---------- */

function DeckBody({ id, slideId }: { id: string; slideId: string | null }) {
  const slides = useSlides(id);
  const comments = useComments(id);
  const shown = (slides.data ?? []).filter((slide) => !slide.variantOf);
  const slide = shown.find((each) => each.id === slideId) ?? shown[0];
  const threads = buildThreads(comments.data ?? []).filter(
    (thread) => thread.root.slideId === slide?.id && thread.root.status === 'open',
  );
  useCallHere(
    'companion-slide',
    slide ? `Folie ${shown.indexOf(slide) + 1}${slide.title ? `: ${slide.title}` : ''}` : null,
  );
  if (slides.isPending) return null;
  if (!slide) return <Failed>Die Präsentation konnte nicht geladen werden.</Failed>;
  return (
    <Column>
      <SlideThumbnail src={slide.thumbnailUrl} className="w-full" />
      <AsidePart label={`Kommentare zu Folie ${shown.indexOf(slide) + 1}`} icon="chatBubble">
        {threads.length === 0 ? (
          <p className="text-caption text-fg-muted">Keine offenen Kommentare auf dieser Folie.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {threads.map((thread) => (
              <CommentRow
                key={thread.id}
                author={thread.root.author}
                replies={thread.replies.length}
              >
                <CommentPreview comment={thread.root} />
              </CommentRow>
            ))}
          </ul>
        )}
      </AsidePart>
    </Column>
  );
}

/* ---------- Writer, Reader: the open comments ---------- */

interface PlainComment {
  id: string;
  parentId: string | null;
  author: Author;
  body: string;
  status: 'open' | 'done';
  anchor: { quote?: string | undefined } | null;
}

function DocumentBody({ id }: { id: string }) {
  const comments = useQuery({
    queryKey: writerKeys.comments(id),
    queryFn: () => fetchDocumentComments(id),
    refetchInterval: AGAIN_MS,
  });
  return <CommentsBody comments={comments.data} pending={comments.isPending} />;
}

function PdfBody({ id }: { id: string }) {
  const comments = useQuery({
    queryKey: ['companion', 'pdf-comments', id],
    queryFn: () => fetchPdfComments(id),
    refetchInterval: AGAIN_MS,
  });
  return <CommentsBody comments={comments.data} pending={comments.isPending} />;
}

function CommentsBody({
  comments,
  pending,
}: {
  comments: readonly PlainComment[] | undefined;
  pending: boolean;
}) {
  if (pending) return null;
  const all = comments ?? [];
  const open = all.filter((comment) => comment.parentId === null && comment.status === 'open');
  const replies = (id: string) => all.filter((comment) => comment.parentId === id).length;
  return (
    <Column>
      <AsidePart label="Offene Kommentare" icon="chatBubble">
        {open.length === 0 ? (
          <p className="text-caption text-fg-muted">Keine offenen Kommentare.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {open.map((comment) => (
              <CommentRow
                key={comment.id}
                author={comment.author}
                replies={replies(comment.id)}
                quote={comment.anchor?.quote}
              >
                {comment.body}
              </CommentRow>
            ))}
          </ul>
        )}
      </AsidePart>
    </Column>
  );
}

function CommentRow({
  author,
  replies,
  quote,
  children,
}: {
  author: Author;
  replies: number;
  quote?: string | undefined;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <Avatar author={author} size={24} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-caption font-semibold text-fg">{author.name}</span>
        {quote && (
          <span className="line-clamp-2 border-l-2 border-hairline pl-2 text-caption text-fg-muted">
            {quote}
          </span>
        )}
        <span className="line-clamp-4 text-body whitespace-pre-line text-fg">{children}</span>
        {replies > 0 && (
          <span className="flex items-center gap-1 text-caption text-fg-subtle">
            <Icon name="chatBubble" size={14} />
            {replies === 1 ? '1 Antwort' : `${replies} Antworten`}
          </span>
        )}
      </div>
    </li>
  );
}

/* ---------- Sonst: today ---------- */

function TodayBody() {
  const head = (label: string) => (link: ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-caption font-semibold tracking-wider text-fg-subtle uppercase">
        {label}
      </h3>
      {link}
    </div>
  );
  return (
    <Column>
      <div className="flex flex-col gap-2">
        <UpcomingEvents
          head={head('Termine')}
          empty={
            <p className="text-caption text-fg-muted">Keine Termine in den nächsten zwei Wochen.</p>
          }
        />
      </div>
      <div className="flex flex-col gap-2">
        <MyTodos
          head={head('Aufgaben')}
          empty={<p className="text-caption text-fg-muted">Keine offenen Aufgaben.</p>}
        />
      </div>
    </Column>
  );
}
