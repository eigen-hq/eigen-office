import { z } from 'zod';

/*
 * What an account keeps of how it left things – the same on each of its devices, the phone beside
 * the computer among them (`GET/PUT /me/kept/:key`, table `user_kept`). Only the keys below.
 */

/** The agent asked beside each mail (`MailAside`): thread id → agent id, the latest last. */
export const KEPT_MAIL_AGENTS = 'mail-agents';
export const MAX_KEPT_MAIL_AGENTS = 200;

/** The calendars one hid in a workspace's calendar (`useHiddenCalendars`). */
export const keptHiddenCalendarsKey = (workspaceId: string) => `hidden-calendars:${workspaceId}`;
export const MAX_KEPT_HIDDEN_CALENDARS = 500;

/** Keys one account keeps at most – one per workspace's calendar, so a loop of made-up ones stops. */
export const MAX_KEPT_KEYS = 100;

const keptId = z.string().min(1).max(100);

export const keptMailAgentsSchema = z
  .record(keptId, keptId)
  .refine((agents) => Object.keys(agents).length <= MAX_KEPT_MAIL_AGENTS);

export const keptHiddenCalendarsSchema = z.array(keptId).max(MAX_KEPT_HIDDEN_CALENDARS);

/** The value a key may hold; `null`: no such key. */
export function keptSchema(key: string): z.ZodType | null {
  if (key === KEPT_MAIL_AGENTS) return keptMailAgentsSchema;
  if (/^hidden-calendars:[\w-]{1,64}$/.test(key)) return keptHiddenCalendarsSchema;
  return null;
}

/** `GET /me/kept/:key`: what is kept – `null` until something was. */
export interface KeptResponse {
  value: unknown;
}
