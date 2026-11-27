import type { CompanionCommand } from '@slider/shared';
import { api, ApiError } from '@/lib/api-client';
import type { ShowToast } from '@/ui';

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
