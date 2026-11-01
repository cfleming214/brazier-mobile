import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, EmptyState, Screen, T } from '@/components/ui';
import { space } from '@/lib/theme';

/** Add Watch modal. Search, URL paste and barcode scan land in DROP-19 to DROP-22. */
export default function AddWatch() {
  return (
    <Screen>
      <View style={{ flex: 1, padding: space.lg, gap: space.lg }}>
        <T variant="display">ADD WATCH</T>
        <EmptyState
          title="Coming in the next build"
          body="Search the catalog, paste a product link, or scan a barcode to start watching."
        />
        <Button label="Close" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
