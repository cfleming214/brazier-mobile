/**
 * Test mode: simulate a restock drop 2 minutes after test mode is turned on.
 *
 * Turning test mode on picks a test listing that isn't in stock, puts a "Test drop" event on the
 * local calendar and schedules a local notification for the drop time. When the drop time
 * arrives, the listing goes in stock (with a stock event), and test mode turns itself off.
 * Turning test mode off before then cancels the drop. The pending drop is saved, so it survives
 * the app being closed: the notification still fires and the drop completes on next launch.
 *
 * Uses the on-device test dataset, so turning test mode on also turns on test data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { AppState, Platform } from 'react-native';
import { captureError } from '../monitoring';
import { openTestDb, testDbSupported } from './db';
import { getTestFlag, loadTestSettings, setTestFlag, subscribeTestSettings } from './settings';

export const SIMULATED_DROP_DELAY_MS = 2 * 60_000;
export const SIMULATED_DROP_EVENT_ID = '55555555-5555-4555-8555-000000000001';
const STATE_KEY = 'brazier.testMode.simulatedDrop';

export type SimulatedDrop = {
  listingId: string;
  productId: string;
  productName: string;
  retailerId: string;
  retailerName: string;
  priceCents: number | null;
  prevState: string;
  dropAt: string;
  notificationId: string | null;
};

export type CompletedDrop = Pick<SimulatedDrop, 'productName' | 'retailerName'> & {
  quantity: number;
  at: string;
};

// ---------------------------------------------------------------------------
// Database steps (take a db so tests can run them on node:sqlite)
// ---------------------------------------------------------------------------

type Candidate = Omit<SimulatedDrop, 'dropAt' | 'notificationId'>;

/** A random listing that isn't in stock, so the drop has something to restock. */
export async function pickDropListingIn(db: SQLiteDatabase): Promise<Candidate | null> {
  return db.getFirstAsync<Candidate>(
    `select rs.id as listingId, p.id as productId, p.name as productName,
            r.id as retailerId, r.name as retailerName,
            rs.last_price_cents as priceCents, rs.last_state as prevState
       from retailer_skus rs
       join products p on p.id = rs.product_id
       join retailers r on r.id = rs.retailer_id
      where rs.last_state != 'IN_STOCK'
      order by random() limit 1`,
  );
}

const shortName = (name: string) => name.replace(/^Pokémon TCG: /, '');

/** Put the upcoming drop on the local calendar. */
export async function scheduleDropEventIn(db: SQLiteDatabase, drop: Candidate & { dropAt: string }) {
  await db.runAsync(
    `insert into calendar_events (id, product_id, set_name, title, event_type, retailer_id, starts_at,
       status, confidence, source_refs, published)
     values (?, ?, (select set_name from products where id = ?), ?, 'restock_window', ?, ?,
       'confirmed', 1.0, ?, 1)
     on conflict (id) do update set product_id = excluded.product_id, set_name = excluded.set_name,
       title = excluded.title, retailer_id = excluded.retailer_id, starts_at = excluded.starts_at,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [
      SIMULATED_DROP_EVENT_ID, drop.productId, drop.productId,
      `Test drop: ${shortName(drop.productName)} at ${drop.retailerName}`,
      drop.retailerId, drop.dropAt,
      JSON.stringify([{ source: 'test-mode', url: null, trust: 'test' }]),
    ],
  );
}

export async function removeDropEventIn(db: SQLiteDatabase) {
  await db.runAsync('delete from calendar_events where id = ?', [SIMULATED_DROP_EVENT_ID]);
}

/** The drop itself: the listing goes in stock and the change is recorded as a stock event. */
export async function completeDropIn(db: SQLiteDatabase, drop: SimulatedDrop, now = new Date()) {
  const quantity = 5 + Math.floor(Math.random() * 36);
  const at = now.toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `update retailer_skus
          set last_state = 'IN_STOCK', quantity_available = ?, last_in_stock_at = ?,
              last_checked_at = ?, confirmations = confirmations + 1, poll_tier = 'hot'
        where id = ?`,
      [quantity, at, at, drop.listingId],
    );
    await db.runAsync(
      `insert into stock_events (retailer_sku_id, prev_state, new_state, price_cents, qty_hint,
         source, observed_at) values (?, ?, 'IN_STOCK', ?, ?, 'poll', ?)`,
      [drop.listingId, drop.prevState, drop.priceCents, quantity, at],
    );
  });
  return { productName: drop.productName, retailerName: drop.retailerName, quantity, at };
}

// ---------------------------------------------------------------------------
// State: the pending drop (saved) and the last completed one (for the settings screen)
// ---------------------------------------------------------------------------

let pending: SimulatedDrop | null = null;
let lastCompleted: CompletedDrop | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getPendingDrop = () => pending;
export const getLastCompletedDrop = () => lastCompleted;
export function subscribeSimulation(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

async function setPending(next: SimulatedDrop | null) {
  pending = next;
  emit();
  if (next) await AsyncStorage.setItem(STATE_KEY, JSON.stringify(next));
  else await AsyncStorage.removeItem(STATE_KEY);
}

/** Called whenever the simulation changes test data (start, cancel, drop), to refresh caches. */
let onDataChanged: () => void = () => {};

// ---------------------------------------------------------------------------
// Controller: reacts to the test mode switch
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let busy: Promise<void> = Promise.resolve();
/** Serialise start/cancel/complete so rapid toggling can't interleave them. */
const queue = (task: () => Promise<void>) => {
  busy = busy.then(task).catch((e) => captureError(e, { where: 'test_mode_drop' }));
  return busy;
};

function arm(drop: SimulatedDrop) {
  if (timer) clearTimeout(timer);
  const wait = Math.max(0, Date.parse(drop.dropAt) - Date.now());
  timer = setTimeout(() => void queue(completeIfDue), wait);
}

async function startDrop() {
  if (pending) return;
  const db = await openTestDb();
  if (!getTestFlag('testData')) await setTestFlag('testData', true);
  const candidate = await pickDropListingIn(db);
  if (!candidate) {
    // Everything is already in stock; nothing to drop.
    await setTestFlag('testMode', false);
    return;
  }
  const dropAt = new Date(Date.now() + SIMULATED_DROP_DELAY_MS).toISOString();
  await scheduleDropEventIn(db, { ...candidate, dropAt });
  const notificationId = await scheduleDropNotification(candidate, dropAt);
  const drop = { ...candidate, dropAt, notificationId };
  await setPending(drop);
  onDataChanged();
  arm(drop);
}

async function cancelDrop() {
  if (timer) clearTimeout(timer);
  timer = null;
  const drop = pending;
  if (!drop) return;
  if (drop.notificationId) await Notifications.cancelScheduledNotificationAsync(drop.notificationId).catch(() => {});
  await removeDropEventIn(await openTestDb());
  await setPending(null);
  onDataChanged();
}

async function completeIfDue() {
  const drop = pending;
  if (!drop) return;
  if (Date.parse(drop.dropAt) > Date.now()) return arm(drop);
  timer = null;
  lastCompleted = await completeDropIn(await openTestDb(), drop);
  await setPending(null);
  // Turn the switch back off. pending is already cleared, so this won't cancel anything.
  await setTestFlag('testMode', false);
  onDataChanged();
}

async function scheduleDropNotification(drop: Candidate, dropAt: string): Promise<string | null> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status === 'undetermined') await Notifications.requestPermissionsAsync();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('restock', {
        name: 'Restock alerts',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `In stock at ${drop.retailerName}`,
        body: `${shortName(drop.productName)} (test drop)`,
        data: { type: 'calendar', eventId: SIMULATED_DROP_EVENT_ID, local: true, test: true },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(dropAt),
        channelId: 'restock',
      },
    });
  } catch (e) {
    // The drop still happens in the app without a notification.
    captureError(e, { where: 'test_mode_drop_notification' });
    return null;
  }
}

let started = false;
let stop: (() => void) | null = null;

/**
 * Start watching the test mode switch. Call once at app start; safe to call again.
 * Restores a saved pending drop, completing it right away if its time has passed.
 */
export function startTestModeController(options: { onDataChanged?: () => void } = {}) {
  if (options.onDataChanged) onDataChanged = options.onDataChanged;
  if (started || !testDbSupported) return stop ?? (() => {});
  started = true;

  let wasOn = false;
  const ready = queue(async () => {
    await loadTestSettings();
    const saved = await AsyncStorage.getItem(STATE_KEY);
    pending = saved ? (JSON.parse(saved) as SimulatedDrop) : null;
    emit();
    wasOn = getTestFlag('testMode');
    if (pending && !wasOn) await cancelDrop();
    else if (pending) await completeIfDue();
    else if (wasOn) await startDrop();
  });

  const unsubscribe = subscribeTestSettings(() => {
    void ready.then(() => {
      const on = getTestFlag('testMode');
      if (on === wasOn) return;
      wasOn = on;
      void queue(on ? startDrop : cancelDrop);
    });
  });
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') void queue(completeIfDue);
  });

  stop = () => {
    unsubscribe();
    appState.remove();
    if (timer) clearTimeout(timer);
    timer = null;
    started = false;
    stop = null;
  };
  return stop;
}

/** For unit tests. */
export async function __settleForTests() {
  await busy;
}
export function __resetSimulationForTests() {
  stop?.();
  pending = null;
  lastCompleted = null;
  listeners.clear();
  busy = Promise.resolve();
  onDataChanged = () => {};
}
