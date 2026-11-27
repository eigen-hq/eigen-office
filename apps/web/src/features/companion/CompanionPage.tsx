import {
  aiInSentence,
  MAX_MATERIAL_CHAT_MESSAGE,
  type CompanionView,
  type Workspace,
} from '@slider/shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAccount } from '@/features/auth';
import { OwnAgentCallButton } from '@/features/calls';
import { CloudProvider, CompanionChat, EventPanel, TodoPanel } from '@/features/cloud';
import { SenderProvider, SenderToast } from '@/features/sender';
import { onCallHere, ownCallHere, useCallHere } from '@/lib/call-here';
import { useCompanionHeard } from '@/lib/companion';
import { isTextTarget } from '@/lib/dom';
import { CLOUD_EVENT_PARAM, CLOUD_TODO_PARAM, routes } from '@/lib/routes';
import { readLastWorkspaceId } from '@/features/workspaces';
import { Icon, IconButton, Toast, useToast, type ShowToast } from '@/ui';
import { CompanionAmbient } from './components/CompanionAmbient';
import { ASKS_ITSELF, CompanionBody } from './components/CompanionBodies';
import { deskThere } from './lib/auto';
import { useAmbient } from './lib/ambient';
import { askDesk } from './lib/command';
import { useHeldView } from './lib/hold';
import { CompanionTitle } from './lib/title';
import { useWakeLock } from './lib/wake-lock';

/** The minute ticking on: a computer left an hour ago no longer keeps the screen on. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** What the computer has open, in a word – above its title. */
const KIND_WORDS = {
  mail: 'Mail',
  chat: 'Unterhaltung',
  calendar: 'Kalender',
  file: 'Datei',
  deck: 'Präsentation',
  document: 'Dokument',
  pdf: 'PDF',
  todo: 'Aufgabe',
  page: 'Am Computer',
} as const;

/** This window's lines for the agent – the computer's and what the phone adds to them. */
function useOwnLines() {
  const [lines, setLines] = useState(ownCallHere);
  useEffect(() => onCallHere(() => setLines(ownCallHere())), []);
  return lines;
}

/**
 * The phone beside the computer (`/begleiter`): what goes with the computer's page – „KI zur
 * Mail“ beside the mail open there, the calendar's column, the slide's comments … – and below it
 * the workspace's AI, asked in writing or called, knowing what the computer shows. The screen
 * stays on while it is open; ✕ or Esc goes back to where one was.
 */
export function Component() {
  const { desk } = useCompanionHeard();
  const account = useAccount();
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, notify] = useToast();
  // On while the computer is there: a phone forgotten on its stand sleeps once it was left.
  const now = useMinute();
  useWakeLock(deskThere(desk, now));
  const [title, setTitle] = useState<string | null>(null);
  // Touched: a new page on the computer waits for „Zeigen“.
  const held = useHeldView(desk?.view ?? null);
  const view = held.view;
  const workspace =
    account.workspaces.find((each) => each.id === view?.workspaceId) ??
    account.workspaces.find((each) => each.id === readLastWorkspaceId()) ??
    account.workspaces[0] ??
    null;
  // Calls from here (and the AI's chat) know what the computer shows.
  useCallHere('companion', view?.here || null);

  // Where one came from – kept: a panel opened here (`?termin=`) leaves no state behind.
  const [from] = useState(() => (location.state as { from?: unknown } | null)?.from);
  const leave = () => {
    if (typeof from === 'string' && from !== routes.companion()) void navigate(from);
    else void navigate(routes.reviews());
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTextTarget(event.target)) return;
      // A panel open over the page closes first (it stops the key itself).
      if (document.querySelector('[data-side-panel], [role="dialog"]')) return;
      leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
        <Icon name="devices" size={20} className="shrink-0 text-fg-muted" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-caption text-fg-muted">
            {desk?.active && <span aria-hidden className="size-2 rounded-full bg-success" />}
            {view ? KIND_WORDS[view.kind] : 'Am Computer'}
          </span>
          <h1 className="truncate text-body font-semibold text-fg">
            {view ? title || view.title || 'Eigen Office' : 'Nichts offen'}
          </h1>
        </div>
        {workspace && desk && <OpenOnDesk workspaceId={workspace.id} notify={notify} />}
        {view && (
          <IconButton
            icon="openInNew"
            label="Hier öffnen"
            variant="ghost"
            onClick={() => void navigate(view.path)}
          />
        )}
        {workspace && <OwnAgentCallButton workspaceId={workspace.id} />}
        <IconButton icon="close" label="Begleiter beenden (Esc)" variant="ghost" onClick={leave} />
      </header>
      {held.waiting && (
        <button
          type="button"
          onClick={held.show}
          className="flex shrink-0 items-center gap-2 border-b border-hairline bg-surface-1 px-3 py-2 text-left text-caption text-fg-muted hover:bg-hover"
        >
          <Icon name="desktopWindows" size={16} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {held.waiting.kind === 'page'
              ? `Am Computer: ${held.waiting.title || 'Eigen Office'}`
              : `Am Computer: ${KIND_WORDS[held.waiting.kind]} | ${held.waiting.title}`}
          </span>
          <span className="shrink-0 font-semibold text-fg">Zeigen</span>
        </button>
      )}
      {workspace ? (
        <CompanionTitle value={setTitle}>
          <CompanionWorkspace
            workspace={workspace}
            view={view}
            active={!!desk?.active}
            notify={notify}
          />
        </CompanionTitle>
      ) : (
        <p className="p-4 text-body text-fg-muted">Du bist noch in keinem Workspace.</p>
      )}
      <Toast toast={toast} />
    </div>
  );
}

/**
 * „Am Computer öffnen“: a to-do or an event opened here (its panel over the page) opens on the
 * computer too – there it can be worked on at the desk.
 */
function OpenOnDesk({ workspaceId, notify }: { workspaceId: string; notify: ShowToast }) {
  const [params] = useSearchParams();
  const todo = params.get(CLOUD_TODO_PARAM);
  const event = params.get(CLOUD_EVENT_PARAM);
  const day = params.get('am');
  const path = todo
    ? `${routes.cloudTodos(workspaceId)}?${new URLSearchParams({ [CLOUD_TODO_PARAM]: todo })}`
    : event && event !== 'neu'
      ? `${routes.cloudCalendar(workspaceId)}?${new URLSearchParams(
          event === 'tag' && day
            ? { [CLOUD_EVENT_PARAM]: 'tag', am: day }
            : { [CLOUD_EVENT_PARAM]: event },
        )}`
      : null;
  if (!path) return null;
  return (
    <IconButton
      icon="desktopWindows"
      label="Am Computer öffnen"
      variant="ghost"
      onClick={() =>
        void askDesk({ type: 'open', path }, notify).then((sent) => {
          // Not seen here: said where it happened.
          if (sent) notify('Am Computer geöffnet.');
        })
      }
    />
  );
}

/** The page's parts inside the workspace's Sender and Cloud – as on the computer. */
function CompanionWorkspace({
  workspace,
  view,
  active,
  notify,
}: {
  workspace: Workspace;
  /** What the phone shows of the computer (held while touched). */
  view: CompanionView | null;
  active: boolean;
  notify: ShowToast;
}) {
  const here = useOwnLines();
  const [chatOpen, setChatOpen] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [params] = useSearchParams();
  // Resting on its stand – not while presenting, the AI's chat or a panel is open.
  const ambient = useAmbient(
    view ? `${view.kind}:${view.id ?? ''}:${view.path}` : '',
    !!view?.show || chatOpen || params.has(CLOUD_TODO_PARAM) || params.has(CLOUD_EVENT_PARAM),
  );
  const send = () => {
    const text = body.trim();
    if (!text) return;
    setBody('');
    setAsk(text);
    setChatOpen(true);
  };
  return (
    <SenderProvider
      workspace={workspace}
      agentPath={(agentId) => routes.cloudAgent(workspace.id, agentId)}
      mailThreadPath={(threadId) => routes.cloudMailThread(workspace.id, threadId)}
    >
      <CloudProvider workspace={workspace}>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {view ? (
            <CompanionBody
              key={`${view.kind}:${view.id ?? ''}`}
              view={view}
              workspace={workspace}
              notify={notify}
            />
          ) : (
            <CompanionBody
              view={{
                kind: 'page',
                workspaceId: workspace.id,
                id: null,
                sub: null,
                title: '',
                path: '',
                here: '',
              }}
              workspace={workspace}
              notify={notify}
            />
          )}
        </main>
        {/* The AI below everything (a column with its own „Nachfragen“ has it there): a question
            in writing opens its chat; called from the header. */}
        {!ASKS_ITSELF.has(view?.kind ?? 'page') && !view?.show && (
          <form
            aria-label={`Nachricht an ${aiInSentence(workspace.aiName)}`}
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
            className="flex shrink-0 items-center gap-1 border-t border-hairline px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          >
            <input
              aria-label="Nachricht"
              value={body}
              maxLength={MAX_MATERIAL_CHAT_MESSAGE}
              onChange={(event) => setBody(event.target.value)}
              placeholder={`Frag ${aiInSentence(workspace.aiName)} dazu …`}
              className="glass-elevated h-10 min-w-0 flex-1 rounded-control px-3 text-body text-fg placeholder:text-fg-subtle focus-visible:outline-none"
            />
            <IconButton
              type="submit"
              icon="arrowUpward"
              label="Senden"
              iconTone={body.trim() ? 'success' : undefined}
            />
          </form>
        )}
        {chatOpen && (
          <CompanionChat
            workspace={workspace}
            here={here}
            ask={ask}
            onAsked={() => setAsk(null)}
            notify={notify}
            onClose={() => setChatOpen(false)}
          />
        )}
        {ambient.resting && (
          <CompanionAmbient
            // What it is, not its title: the screen is seen by whoever passes.
            line={
              !view
                ? 'Kein Computer offen'
                : view.kind === 'page'
                  ? 'Am Computer'
                  : `Am Computer: ${KIND_WORDS[view.kind]}`
            }
            active={active}
            onWake={ambient.wake}
          />
        )}
        {/* A to-do or an event tapped opens here, as in Cloud. */}
        <TodoPanel />
        <EventPanel />
        <SenderToast />
      </CloudProvider>
    </SenderProvider>
  );
}
