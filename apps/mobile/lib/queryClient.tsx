import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { ReactNode } from 'react';

// Pause queries and mutations while offline; resume and refetch on reconnect.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 1000 * 60 * 60 * 24 * 7, // keep cached data for a week so Radar renders offline
      retry: 2,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'offlineFirst', retry: 3 },
  },
});

/**
 * Queries tagged `meta.persist = false` (device-only checkout profiles) must never be written
 * to AsyncStorage, which is unencrypted. Only successful queries are persisted.
 */
export function shouldPersistQuery(q: {
  state: { status: string };
  meta?: Record<string, unknown>;
}) {
  return q.state.status === 'success' && q.meta?.persist !== false;
}

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'drophawk-query-cache',
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        buster: 'v1',
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
      onSuccess={() => queryClient.resumePausedMutations()}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
