import { ScrollView } from 'react-native';
import { EmptyState, Panel, Screen, T } from '@/components/ui';
import { space } from '@/lib/theme';

export default function Calendar() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <T variant="display">CALENDAR</T>
        <Panel>
          <EmptyState
            title="No drops scheduled yet"
            body="Set releases, preorder windows and restock windows will show up here."
          />
        </Panel>
      </ScrollView>
    </Screen>
  );
}
