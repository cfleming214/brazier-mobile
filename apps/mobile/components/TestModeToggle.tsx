import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Panel, T } from '@/components/ui';
import { openTestDb, summarizeTestDb, testDbSupported, type TestDbSummary } from '@/lib/testMode/db';
import { useTestMode } from '@/lib/testMode/settings';
import { captureError } from '@/lib/monitoring';
import { colors, fonts, space } from '@/lib/theme';

/** Settings switch for test mode. Turning it on opens (and on first use, seeds) the local dataset. */
export function TestModeToggle() {
  const [enabled, setEnabled] = useTestMode();
  const [summary, setSummary] = useState<TestDbSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !testDbSupported) return;
    let cancelled = false;
    openTestDb()
      .then(summarizeTestDb)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => {
        captureError(e, { where: 'test_mode_db' });
        if (!cancelled) setError('Could not load the test dataset.');
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  let status = 'Uses a local dataset of sample products and retailers instead of live data.';
  if (enabled && !testDbSupported) status = 'Test data is only available on iOS and Android.';
  else if (enabled && error) status = error;
  else if (enabled && summary)
    status = `${summary.products} products · ${summary.retailers} retailers · ${summary.listings} listings (${summary.inStock} in stock)`;
  else if (enabled) status = 'Loading test dataset…';

  return (
    <Panel title="Test mode">
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: fonts.bodyMedium }}>Test mode</T>
          <T testID="test-mode-status" variant="muted" style={{ fontSize: 12 }}>
            {status}
          </T>
        </View>
        <Switch
          testID="test-mode-toggle"
          value={enabled}
          onValueChange={(v) => void setEnabled(v)}
          trackColor={{ true: colors.accent, false: colors.line }}
        />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
