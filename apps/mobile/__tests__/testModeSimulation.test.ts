/**
 * Test mode's simulated drop, end to end against a real SQLite database (node:sqlite) with fake
 * timers: start, drop after 2 minutes, cancel early, and resume after an app restart.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { describeSqlite, openMemoryDb, type NodeDb } from './helpers/sqlite';
import { rebuild } from '@/lib/testMode/db';
import { __resetTestSettingsForTests, getTestFlag, setTestFlag } from '@/lib/testMode/settings';
import {
  __resetSimulationForTests,
  __settleForTests,
  getLastCompletedDrop,
  getPendingDrop,
  SIMULATED_DROP_DELAY_MS,
  SIMULATED_DROP_EVENT_ID,
  startTestModeController,
  type SimulatedDrop,
} from '@/lib/testMode/simulation';

const mockDb: { current: unknown } = { current: null };
jest.mock('@/lib/testMode/db', () => ({
  ...jest.requireActual('@/lib/testMode/db'),
  testDbSupported: true,
  openTestDb: async () => mockDb.current,
}));
jest.mock('@/lib/monitoring', () => ({ captureError: jest.fn() }));

const notifications = jest.mocked(Notifications);
const NOW = Date.parse('2026-11-02T18:00:00Z');
let raw: NodeDb;
let onDataChanged: jest.Mock;

/** Let queued async work run, including timers that are already due. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await __settleForTests();
    await Promise.resolve();
  }
}

const listing = (id: string) =>
  raw.prepare('select last_state, quantity_available from retailer_skus where id = ?').get(id) as {
    last_state: string;
    quantity_available: number;
  };
const dropEvent = () =>
  raw.prepare('select title, starts_at, event_type from calendar_events where id = ?').get(SIMULATED_DROP_EVENT_ID);

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
  __resetSimulationForTests();
  __resetTestSettingsForTests();
  await AsyncStorage.clear();
  const opened = openMemoryDb();
  raw = opened.raw;
  mockDb.current = opened.db;
  await rebuild(opened.db);
  onDataChanged = jest.fn();
});

afterEach(() => {
  __resetSimulationForTests();
  jest.useRealTimers();
  raw.close();
});

describeSqlite('test mode simulated drop', () => {
  async function turnOn() {
    startTestModeController({ onDataChanged });
    await settle();
    await setTestFlag('testMode', true);
    await settle();
    return getPendingDrop() as SimulatedDrop;
  }

  it('schedules a drop 2 minutes out and turns on test data', async () => {
    const drop = await turnOn();
    expect(drop).not.toBeNull();
    expect(Date.parse(drop.dropAt)).toBe(NOW + SIMULATED_DROP_DELAY_MS);
    expect(getTestFlag('testData')).toBe(true);
    expect(listing(drop.listingId).last_state).not.toBe('IN_STOCK');
    expect(dropEvent()).toMatchObject({ starts_at: drop.dropAt, event_type: 'restock_window' });
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: `In stock at ${drop.retailerName}` }),
        trigger: expect.objectContaining({ date: new Date(drop.dropAt) }),
      }),
    );
    expect(onDataChanged).toHaveBeenCalled();
  });

  it('restocks the listing at drop time and turns test mode back off', async () => {
    const drop = await turnOn();
    jest.advanceTimersByTime(SIMULATED_DROP_DELAY_MS - 1000);
    await settle();
    expect(getPendingDrop()).not.toBeNull();
    expect(getTestFlag('testMode')).toBe(true);

    jest.advanceTimersByTime(1000);
    await settle();
    expect(getPendingDrop()).toBeNull();
    expect(getTestFlag('testMode')).toBe(false);
    expect(getTestFlag('testData')).toBe(true);
    const after = listing(drop.listingId);
    expect(after.last_state).toBe('IN_STOCK');
    expect(after.quantity_available).toBeGreaterThan(0);
    const event = raw
      .prepare('select prev_state, new_state from stock_events where retailer_sku_id = ? order by id desc')
      .get(drop.listingId);
    expect(event).toEqual({ prev_state: drop.prevState, new_state: 'IN_STOCK' });
    expect(getLastCompletedDrop()).toMatchObject({ productName: drop.productName });
    // The notification fires on its own; it must not be cancelled.
    expect(notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('brazier.testMode.simulatedDrop')).toBeNull();
  });

  it('cancels the drop when test mode is turned off early', async () => {
    const drop = await turnOn();
    await setTestFlag('testMode', false);
    await settle();
    expect(getPendingDrop()).toBeNull();
    expect(dropEvent()).toBeUndefined();
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-1');

    jest.advanceTimersByTime(SIMULATED_DROP_DELAY_MS * 2);
    await settle();
    expect(listing(drop.listingId).last_state).toBe(drop.prevState);
  });

  it('finishes an overdue drop when the app starts again', async () => {
    const drop = await turnOn();
    // Simulate the app being closed, then reopened after the drop time.
    __resetSimulationForTests();
    jest.setSystemTime(NOW + SIMULATED_DROP_DELAY_MS + 60_000);
    startTestModeController({ onDataChanged });
    await settle();
    expect(listing(drop.listingId).last_state).toBe('IN_STOCK');
    expect(getTestFlag('testMode')).toBe(false);
    expect(getPendingDrop()).toBeNull();
  });
});
