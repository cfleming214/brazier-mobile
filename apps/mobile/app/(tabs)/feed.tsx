import { ScrollView } from 'react-native';
import { EmptyState, Panel, Screen, T } from '@/components/ui';
import { space } from '@/lib/theme';

export default function Feed() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <T variant="display">FEED</T>
        <Panel>
          <EmptyState
            title="Community sightings are coming"
            body="In-store sightings and drop intel from other collectors will appear here."
          />
        </Panel>
      </ScrollView>
    </Screen>
  );
}
