import { aiInSentence, MAX_MATERIAL_CHAT_MESSAGE, type Workspace } from '@slider/shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAccount } from '@/features/auth';
import { OwnAgentCallButton } from '@/features/calls';
import { CloudProvider, CompanionChat } from '@/features/cloud';
import { EventPanel } from '@/features/cloud/components/calendar/EventPanel';
import { TodoPanel } from '@/features/cloud/components/todos/TodoList';
import { SenderProvider, SenderToast } from '@/features/sender';
import { onCallHere, ownCallHere, useCallHere } from '@/lib/call-here';
import { useCompanionHeard } from '@/lib/companion';
import { isTextTarget } from '@/lib/dom';
import { routes } from '@/lib/routes';
import { readLastWorkspaceId } from '@/features/workspaces/lib/last-workspace';
import { Icon, IconButton, Toast, useToast, type ShowToast } from '@/ui';
import { ASKS_ITSELF, CompanionBody } from './components/CompanionBodies';
import { deskThere } from './lib/auto';
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
  const view = desk?.view ?? null;
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
      {workspace ? (
        <CompanionTitle value={setTitle}>
          <CompanionWorkspace workspace={workspace} notify={notify} />
        </CompanionTitle>
      ) : (
        <p className="p-4 text-body text-fg-muted">Du bist noch in keinem Workspace.</p>
      )}
      <Toast toast={toast} />
    </div>
  );
}

/** The page's parts inside the workspace's Sender and Cloud – as on the computer. */
function CompanionWorkspace({ workspace, notify }: { workspace: Workspace; notify: ShowToast }) {
  const { desk } = useCompanionHeard();
  const view = desk?.view ?? null;
  const here = useOwnLines();
  const [chatOpen, setChatOpen] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const [body, setBody] = useState('');
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
        {!ASKS_ITSELF.has(view?.kind ?? 'page') && (
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
        {/* A to-do or an event tapped opens here, as in Cloud. */}
        <TodoPanel />
        <EventPanel />
        <SenderToast />
      </CloudProvider>
    </SenderProvider>
  );
}
