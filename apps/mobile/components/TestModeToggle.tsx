import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Panel, T } from '@/components/ui';
import { openTestDb, summarizeTestDb, testDbSupported, type TestDbSummary } from '@/lib/testMode/db';
import { useTestData, useTestMode } from '@/lib/testMode/settings';
import { captureError } from '@/lib/monitoring';
import { colors, fonts, space } from '@/lib/theme';

/** Settings switches for test mode and test data. */
export function TestModeToggle() {
  const [testMode, setTestMode] = useTestMode();
  const [testData, setTestData] = useTestData();
  const [summary, setSummary] = useState<TestDbSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [testData]);

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
        body="For testing the app. What it changes is coming soon."
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
