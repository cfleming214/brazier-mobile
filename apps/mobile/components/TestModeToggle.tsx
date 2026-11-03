import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Panel, T } from '@/components/ui';
import { openTestDb, summarizeTestDb, testDbSupported, type TestDbSummary } from '@/lib/testMode/db';
import { useTestData, useTestMode } from '@/lib/testMode/settings';
import {
  getLastCompletedDrop,
  getPendingDrop,
  subscribeSimulation,
  type CompletedDrop,
  type SimulatedDrop,
} from '@/lib/testMode/simulation';
import { captureError } from '@/lib/monitoring';
import { colors, fonts, space } from '@/lib/theme';

/** Settings switches for test mode and test data. */
export function TestModeToggle() {
  const [testMode, setTestMode] = useTestMode();
  const [testData, setTestData] = useTestData();
  const [summary, setSummary] = useState<TestDbSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { pending, last, status: modeStatus } = useTestModeStatus(testMode);

  // Reload the counts when a simulated drop restocks something.
  useEffect(() => {
    if (!testData || !testDbSupported) return;
    let cancelled = false;
    setError(null);
    openTestDb()
      .then(summarizeTestDb)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => {
        captureError(e, { where: 'test_data_db' });
        if (!cancelled) setError('Could not load the test dataset.');
      });
    return () => {
      cancelled = true;
    };
  }, [testData, last]);

  let dataStatus = 'Show products and retailers from a local dataset instead of live data.';
  if (testData && !testDbSupported) dataStatus = 'Test data is only available on iOS and Android.';
  else if (testData && error) dataStatus = error;
  else if (testData && summary)
    dataStatus = `${summary.products} products · ${summary.retailers} retailers · ${summary.listings} listings (${summary.inStock} in stock)`;
  else if (testData) dataStatus = 'Loading test dataset…';

  return (
    <Panel title="Testing">
      <Row
        title="Test mode"
        body={modeStatus}
        bodyTestID={pending ? 'test-mode-countdown' : 'test-mode-status'}
        testID="test-mode-toggle"
        value={testMode}
        onChange={setTestMode}
      />
      <Row
        title="Use test data"
        body={dataStatus}
        bodyTestID="test-data-status"
        testID="test-data-toggle"
        value={testData}
        onChange={setTestData}
      />
    </Panel>
  );
}

const shortName = (name: string) => name.replace(/^Pokémon TCG: /, '');

/** Countdown while a simulated drop is pending, then what dropped. */
function useTestModeStatus(enabled: boolean) {
  const pending = useSyncExternalStore(subscribeSimulation, getPendingDrop, getPendingDrop);
  const last = useSyncExternalStore(subscribeSimulation, getLastCompletedDrop, getLastCompletedDrop);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pending) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pending]);

  let status = 'Simulates a restock drop 2 minutes after you turn it on, then turns itself off.';
  if (!testDbSupported) status = 'Test mode is only available on iOS and Android.';
  else if (pending) status = pendingLabel(pending, now);
  else if (enabled) status = 'Setting up a test drop…';
  else if (last) status = completedLabel(last);
  return { pending, last, status };
}

function pendingLabel(d: SimulatedDrop, now: number) {
  const secs = Math.max(0, Math.ceil((Date.parse(d.dropAt) - now) / 1000));
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return `${secs > 0 ? `Drops in ${clock}` : 'Dropping now'}: ${shortName(d.productName)} at ${d.retailerName}`;
}

function completedLabel(d: CompletedDrop) {
  const time = new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Dropped at ${time}: ${shortName(d.productName)} at ${d.retailerName}, ${d.quantity} in stock. Turn on to run another.`;
}

function Row(props: {
  title: string;
  body: string;
  bodyTestID?: string;
  testID: string;
  value: boolean;
  onChange: (v: boolean) => Promise<void>;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: fonts.bodyMedium }}>{props.title}</T>
        <T testID={props.bodyTestID} variant="muted" style={{ fontSize: 12 }}>
          {props.body}
        </T>
      </View>
      <Switch
        testID={props.testID}
        value={props.value}
        onValueChange={(v) => void props.onChange(v)}
        trackColor={{ true: colors.accent, false: colors.line }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
