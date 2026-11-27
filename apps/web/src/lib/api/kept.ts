import type { KeptResponse } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api } from '../api-client';
import { readJson, readString, writeJson } from '../storage';

export const keptKeys = { one: (key: string) => ['kept', key] as const };

const keptPath = (key: string) => `/me/kept/${encodeURIComponent(key)}`;

/**
 * What the account keeps under `key` (`packages/shared/src/kept.ts`) – the same on each of its
 * devices, the phone beside the computer among them. `local`: this browser's copy, shown at once
 * while the server is asked and kept in step with it; what a browser kept alone before goes up
 * the first time the server has nothing. A change shows at once and is sent behind it.
 */
export function useKept<T>(
  key: string,
  local: string,
  parse: (value: unknown) => T,
  fallback: T,
): [T, (next: T) => void] {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keptKeys.one(key),
    queryFn: async () => (await api.get<KeptResponse>(keptPath(key))).value,
    initialData: () =>
      readString(local) === null ? undefined : readJson<unknown>(local, (value) => value, null),
    // This browser's copy is shown, never trusted: the server is asked at once.
    initialDataUpdatedAt: 0,
  });
  const send = useMutation({
    scope: { id: `kept:${key}` },
    mutationFn: (value: T) => api.put<KeptResponse>(keptPath(key), { value }),
    // Refused (a value too big, offline): what the server keeps comes back.
    onError: () => void queryClient.invalidateQueries({ queryKey: keptKeys.one(key) }),
  });
  const fetched = query.isFetched && !query.isError;
  const data = query.data;
  useEffect(() => {
    if (!fetched) return;
    if (data !== null && data !== undefined) writeJson(local, data);
    else if (readString(local) !== null) {
      // Kept in this browser alone so far: up it goes, for the other devices.
      const before = readJson<T>(local, parse, fallback);
      queryClient.setQueryData(keptKeys.one(key), before);
      send.mutate(before);
    }
    // Once the server answered (and when what it keeps changes) – not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, data, key, local]);
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
    queryClient.setQueryData(keptKeys.one(key), next);
    writeJson(local, next);
    send.mutate(next);
  };
  return [value, set];
}
