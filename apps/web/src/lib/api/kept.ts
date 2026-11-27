import type { KeptResponse } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api } from '../api-client';
import { readJson, readString, writeJson, writeString } from '../storage';
import { useOtherAccounts } from './auth';
import { useMe } from './me';

export const keptKeys = { one: (userId: string, key: string) => ['kept', userId, key] as const };

const keptPath = (key: string) => `/me/kept/${encodeURIComponent(key)}`;

/** Browser copies on their way up – one upload each, however many places use the key. */
const goingUp = new Set<string>();

/**
 * What the account keeps under `key` (`packages/shared/src/kept.ts`) – the same on each of its
 * devices, the phone beside the computer among them. `local`: the name of this browser's copy
 * (per account – several can be signed in here), shown at once while the server is asked and kept
 * in step with it. What the browser kept alone before, under `local` itself, goes up once – only
 * where no other account is signed in here (whose it was is unknown otherwise). A change shows at
 * once and is sent behind it – applied to what the server keeps right then, so a change made on
 * the other device meanwhile (the phone beside the computer) is not overwritten.
 */
export function useKept<T>(
  key: string,
  local: string,
  parse: (value: unknown) => T,
  fallback: T,
): [T, (change: (current: T) => T) => void] {
  const queryClient = useQueryClient();
  const userId = useMe().data?.user?.id ?? null;
  const own = userId ? `${local}:${userId}` : null;
  const queryKey = keptKeys.one(userId ?? '', key);
  const query = useQuery({
    queryKey,
    queryFn: async () => (await api.get<KeptResponse>(keptPath(key))).value,
    enabled: userId !== null,
    initialData: () =>
      own && readString(own) !== null ? readJson<unknown>(own, (value) => value, null) : undefined,
    // This browser's copy is shown, never trusted: the server is asked at once.
    initialDataUpdatedAt: 0,
  });
  const read = (value: unknown): T => {
    if (value === null || value === undefined) return fallback;
    try {
      return parse(value);
    } catch {
      return fallback;
    }
  };
  const mutationKey = ['kept-write', ...queryKey];
  const send = useMutation({
    mutationKey,
    scope: { id: `kept:${key}` },
    // One after the other (`scope`), each on what the server keeps by then.
    mutationFn: async (change: (current: T) => T) => {
      const now = read((await api.get<KeptResponse>(keptPath(key))).value);
      return (await api.put<KeptResponse>(keptPath(key), { value: change(now) })).value;
    },
    onSuccess: (value) => {
      // Another change still on its way shows its own value till it is through.
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      queryClient.setQueryData(queryKey, value);
    },
    // Refused (a value too big, offline): what the server keeps comes back.
    onError: () => void queryClient.invalidateQueries({ queryKey }),
  });
  const fetched = query.isFetched && !query.isError;
  const data = query.data;
  const empty = fetched && (data === null || data === undefined);
  const legacy = empty && readString(local) !== null;
  const others = useOtherAccounts(legacy);
  useEffect(() => {
    if (!own || !fetched) return;
    if (!empty) {
      writeJson(own, data);
      return;
    }
    // Kept in this browser alone so far, by this account: up it goes, for the other devices.
    if (!legacy || others.data === undefined) return;
    // Read again now: another use of the same key in this render may have sent it up already.
    if (others.data.length === 0 && readString(local) !== null && !goingUp.has(local)) {
      const before = readJson<T>(local, parse, fallback);
      queryClient.setQueryData(queryKey, before);
      writeJson(own, before);
      goingUp.add(local);
      // The browser's copy goes only once the server has it (offline, it is tried next time).
      send.mutate(() => before, {
        onSuccess: () => writeString(local, null),
        onSettled: () => goingUp.delete(local),
      });
    }
    // Once the server answered (and when what it keeps changes) – not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, fetched, data, others.data]);
  // `parse` and `fallback` are the caller's constants.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => read(data), [data]);
  const set = (change: (current: T) => T) => {
    // An answer still on its way is older than this: it must not overwrite it.
    void queryClient.cancelQueries({ queryKey });
    const next = change(read(queryClient.getQueryData(queryKey)));
    queryClient.setQueryData(queryKey, next);
    if (own) writeJson(own, next);
    send.mutate(change);
  };
  return [value, set];
}
