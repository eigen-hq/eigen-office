import type { KeptResponse } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api } from '../api-client';
import { readJson, readString, writeJson, writeString } from '../storage';
import { useOtherAccounts } from './auth';
import { useMe } from './me';

export const keptKeys = { one: (userId: string, key: string) => ['kept', userId, key] as const };

const keptPath = (key: string) => `/me/kept/${encodeURIComponent(key)}`;

/**
 * What the account keeps under `key` (`packages/shared/src/kept.ts`) – the same on each of its
 * devices, the phone beside the computer among them. `local`: the name of this browser's copy
 * (per account – several can be signed in here), shown at once while the server is asked and kept
 * in step with it. What the browser kept alone before, under `local` itself, goes up once – only
 * where no other account is signed in here (whose it was is unknown otherwise). A change shows at
 * once and is sent behind it.
 */
export function useKept<T>(
  key: string,
  local: string,
  parse: (value: unknown) => T,
  fallback: T,
): [T, (next: T) => void] {
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
  const send = useMutation({
    scope: { id: `kept:${key}` },
    mutationFn: (value: T) => api.put<KeptResponse>(keptPath(key), { value }),
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
    if (others.data.length === 0) {
      const before = readJson<T>(local, parse, fallback);
      queryClient.setQueryData(queryKey, before);
      writeJson(own, before);
      send.mutate(before);
      writeString(local, null);
    }
    // Once the server answered (and when what it keeps changes) – not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, fetched, data, others.data]);
  const value = useMemo(() => {
    if (data === null || data === undefined) return fallback;
    try {
      return parse(data);
    } catch {
      return fallback;
    }
    // `parse` and `fallback` are the caller's constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const set = (next: T) => {
    // An answer still on its way is older than this: it must not overwrite it.
    void queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, next);
    if (own) writeJson(own, next);
    send.mutate(next);
  };
  return [value, set];
}
