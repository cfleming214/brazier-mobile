import type { CreateWatchInput } from '@drophawk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export const keys = {
  watches: ['watches'] as const,
  watch: (id: string) => ['watch', id] as const,
  search: (q: string) => ['search', q] as const,
  product: (id: string) => ['product', id] as const,
  nextEvent: ['calendar', 'next'] as const,
  stockEvents: (productId: string) => ['stock-events', productId] as const,
};

export const useWatches = () =>
  useQuery({ queryKey: keys.watches, queryFn: api.listWatches, refetchInterval: 15_000 });

export const useWatch = (id: string) =>
  useQuery({ queryKey: keys.watch(id), queryFn: () => api.getWatch(id), refetchInterval: 15_000 });

export const useProductSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.searchProducts(q),
    enabled: q.trim().length >= 2,
  });

export const useProduct = (id: string | null) =>
  useQuery({ queryKey: keys.product(id ?? ''), queryFn: () => api.getProduct(id!), enabled: !!id });

export const useNextEvent = () =>
  useQuery({ queryKey: keys.nextEvent, queryFn: api.nextCalendarEvent, staleTime: 60_000 });

export const useStockEvents = (productId: string | undefined) =>
  useQuery({
    queryKey: keys.stockEvents(productId ?? ''),
    queryFn: () => api.productStockEvents(productId!),
    enabled: !!productId,
    staleTime: 60_000,
  });

export function useCreateWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWatchInput) => api.createWatch(input),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.watches }),
  });
}

/** Optimistic update so pause/edit feel instant and work offline. */
export function useUpdateWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateWatch>[1] }) =>
      api.updateWatch(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.watches });
      const prev = qc.getQueryData<api.WatchOverview[]>(keys.watches);
      qc.setQueryData<api.WatchOverview[]>(keys.watches, (old) =>
        old?.map((w) => (w.watch_id === id ? ({ ...w, ...patch } as api.WatchOverview) : w)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.watches, ctx.prev),
    onSettled: (_d, _e, { id }) => {
      qc.invalidateQueries({ queryKey: keys.watches });
      qc.invalidateQueries({ queryKey: keys.watch(id) });
    },
  });
}

export function useDeleteWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWatch(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.watches });
      const prev = qc.getQueryData<api.WatchOverview[]>(keys.watches);
      qc.setQueryData<api.WatchOverview[]>(keys.watches, (old) =>
        old?.filter((w) => w.watch_id !== id),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.watches, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.watches }),
  });
}

export const accountKeys = {
  profile: ['me', 'profile'] as const,
  hitRate: ['me', 'hit-rate'] as const,
  checkoutProfiles: ['device', 'checkout-profiles'] as const,
};

export const useMyProfile = () =>
  useQuery({ queryKey: accountKeys.profile, queryFn: api.getMyProfile, staleTime: 60_000 });

export const useHitRate = () =>
  useQuery({ queryKey: accountKeys.hitRate, queryFn: api.getHitRate, staleTime: 60_000 });
