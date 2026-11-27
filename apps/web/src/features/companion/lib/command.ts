import type { CompanionCommand, CompanionDesk } from '@slider/shared';
import { api, ApiError } from '@/lib/api-client';
import { companionHeard, onCompanionHeard } from '@/lib/companion';
import type { ShowToast } from '@/ui';

/** A page asked to open at the computer shows there by then – or it did not take it. */
const OPENED_MS = 5_000;

/**
 * Asks the computer the phone shows (`POST /calls/companion/command`) – a step of its slide show,
 * a page to open. Refused (no computer there, too many): said in a toast; `false`.
 */
export async function askDesk(command: CompanionCommand, notify: ShowToast): Promise<boolean> {
  try {
    await api.post('/calls/companion/command', { command });
    return true;
  } catch (error) {
    notify(
      error instanceof ApiError ? error.message : 'Der Computer ist nicht erreichbar.',
      'danger',
    );
    return false;
  }
}

/** The computer shows the page `path` names: its address, and each of the asked search's values. */
export function deskShows(desk: CompanionDesk | null, path: string): boolean {
  if (!desk) return false;
  const asked = new URL(path, 'https://app.invalid');
  const there = new URL(desk.view.path, 'https://app.invalid');
  return (
    asked.pathname === there.pathname &&
    [...asked.searchParams].every(([key, value]) => there.searchParams.get(key) === value)
  );
}

/**
 * „Am Computer öffnen“: asked, then waited for until the computer says it shows that page – a
 * stream gone unnoticed takes the command without a word. Said where it happened (not seen here).
 */
export async function openAtDesk(path: string, notify: ShowToast): Promise<void> {
  if (!(await askDesk({ type: 'open', path }, notify))) return;
  const shown = await new Promise<boolean>((resolve) => {
    const look = () => {
      if (!deskShows(companionHeard().desk, path)) return;
      done(true);
    };
    const stop = onCompanionHeard(look);
    const timer = setTimeout(() => done(false), OPENED_MS);
    function done(result: boolean) {
      stop();
      clearTimeout(timer);
      resolve(result);
    }
    look();
  });
  if (shown) notify('Am Computer geöffnet.');
  else notify('Der Computer hat die Seite nicht geöffnet.', 'danger');
}
