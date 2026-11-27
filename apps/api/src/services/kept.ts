import { MAX_KEPT_KEYS } from '@slider/shared';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { userKept } from '../db/schema';
import { badRequest } from '../http/errors';

/** What the account keeps under `key` (`packages/shared/src/kept.ts`); `null`: nothing yet. */
export async function readKept(db: Database, userId: string, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: userKept.value })
    .from(userKept)
    .where(and(eq(userKept.userId, userId), eq(userKept.key, key)));
  return row?.value ?? null;
}

/**
 * Keeps `value` under `key` – checked against the key's schema before. A new key past
 * `MAX_KEPT_KEYS` is refused (the hidden-calendars key takes any workspace id).
 */
export async function keep(db: Database, userId: string, key: string, value: unknown) {
  const keys = await db
    .select({ key: userKept.key })
    .from(userKept)
    .where(eq(userKept.userId, userId));
  if (keys.length >= MAX_KEPT_KEYS && !keys.some((row) => row.key === key)) {
    throw badRequest('Zu viele gemerkte Einstellungen.');
  }
  await db
    .insert(userKept)
    .values({ userId, key, value })
    .onConflictDoUpdate({
      target: [userKept.userId, userKept.key],
      set: { value, updatedAt: new Date() },
    });
}

/** All the account keeps, for its export. */
export const allKept = (db: Database, userId: string) =>
  db
    .select({ key: userKept.key, value: userKept.value, updatedAt: userKept.updatedAt })
    .from(userKept)
    .where(eq(userKept.userId, userId));
