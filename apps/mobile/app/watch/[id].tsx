import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Button, Panel, Screen, T } from '@/components/ui';
import { space } from '@/lib/theme';

/** Watch Detail. Deep link target for alerts: drophawk://watch/:id. Built out in DROP-25. */
export default function WatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <View style={{ padding: space.lg, gap: space.md }}>
        <T variant="display">WATCH</T>
        <Panel title="Watch ID">
          <T variant="mono" testID="watch-id">
            {id}
          </T>
        </Panel>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
