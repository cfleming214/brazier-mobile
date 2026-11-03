import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { testDbSupported } from './db';

/**
 * Test switches, saved on this device.
 * - testMode: not defined yet.
 * - testData: products and retailers come from the on-device dataset (lib/testMode) instead of
 *   Supabase. Only takes effect where the test database is supported (iOS and Android).
 */
export type TestFlag = 'testMode' | 'testData';

const KEYS: Record<TestFlag, string> = {
  testMode: 'brazier.testMode.enabled',
  testData: 'brazier.testData.enabled',
};

let flags: Record<TestFlag, boolean> = { testMode: false, testData: false };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Read saved switches once; later calls reuse the same promise. */
export function loadTestSettings(): Promise<void> {
  loaded ??= AsyncStorage.multiGet(Object.values(KEYS))
    .then((pairs) => {
      const saved = Object.fromEntries(pairs);
      flags = {
        testMode: saved[KEYS.testMode] === 'true',
        testData: saved[KEYS.testData] === 'true',
      };
      emit();
    })
    .catch(() => {});
  return loaded;
}

export function getTestFlag(flag: TestFlag) {
  return flags[flag];
}

export async function setTestFlag(flag: TestFlag, value: boolean) {
  flags = { ...flags, [flag]: value };
  emit();
  await AsyncStorage.setItem(KEYS[flag], String(value));
}

/** True when product and retailer reads should go to the on-device dataset. */
export function isTestDataActive() {
  return flags.testData && testDbSupported;
}

export type DataSource = 'test' | 'live';

/** Where catalog reads go right now. Waits for saved switches so the first query is right. */
export async function currentDataSource(): Promise<DataSource> {
  await loadTestSettings();
  return isTestDataActive() ? 'test' : 'live';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useFlag(flag: TestFlag): [boolean, (next: boolean) => Promise<void>] {
  useEffect(() => {
    void loadTestSettings();
  }, []);
  const get = () => flags[flag];
  const value = useSyncExternalStore(subscribe, get, get);
  return [value, (next) => setTestFlag(flag, next)];
}

export const useTestMode = () => useFlag('testMode');
export const useTestData = () => useFlag('testData');

/** For query keys, so live and test results are cached separately. */
export function useDataSource(): DataSource {
  useEffect(() => {
    void loadTestSettings();
  }, []);
  return useSyncExternalStore(subscribe, isTestDataActive, isTestDataActive) ? 'test' : 'live';
}

/** For unit tests. */
export function __resetTestSettingsForTests() {
  flags = { testMode: false, testData: false };
  loaded = null;
  listeners.clear();
}
