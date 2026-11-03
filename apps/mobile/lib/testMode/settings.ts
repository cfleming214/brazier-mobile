import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * Test mode on/off, saved on this device. What test mode changes in the app is not defined yet;
 * for now it only makes the bundled dataset (lib/testMode/dataset.ts) available on device.
 */
const KEY = 'brazier.testMode.enabled';

let enabled = false;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function loadTestMode(): Promise<void> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((v) => {
      enabled = v === 'true';
      emit();
    })
    .catch(() => {});
  return loaded;
}

export function isTestModeEnabled() {
  return enabled;
}

export async function setTestModeEnabled(next: boolean) {
  enabled = next;
  emit();
  await AsyncStorage.setItem(KEY, String(next));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTestMode(): [boolean, (next: boolean) => Promise<void>] {
  useEffect(() => {
    void loadTestMode();
  }, []);
  const value = useSyncExternalStore(subscribe, isTestModeEnabled, isTestModeEnabled);
  return [value, setTestModeEnabled];
}

/** For unit tests. */
export function __resetTestModeForTests() {
  enabled = false;
  loaded = null;
  listeners.clear();
}
