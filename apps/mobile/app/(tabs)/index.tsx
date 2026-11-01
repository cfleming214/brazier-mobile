import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Button, EmptyState, Panel, Screen, T } from '@/components/ui';
import { colors, radius, space } from '@/lib/theme';

/** Radar (home). Phase 0 shell; live sections land in DROP-23 and DROP-40. */
export default function Radar() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <T variant="display">RADAR</T>
            <T variant="mono" style={{ color: colors.muted, letterSpacing: 1.2 }}>
              OPS · POKÉMON TCG
            </T>
          </View>
          <View style={styles.headerIcons}>
            <View style={styles.iconBtn}>
              <Icon name="search" color={colors.ink} size={18} />
            </View>
            <View style={styles.iconBtn}>
              <Icon name="bell" color={colors.ink} size={18} />
            </View>
          </View>
        </View>

        <View style={styles.sys} testID="system-strip">
          <View style={[styles.dot, { backgroundColor: colors.muted }]} />
          <T variant="mono" style={{ color: colors.muted }}>
            POLLER NOT CONNECTED
          </T>
        </View>

        <Panel title="Your watches">
          <EmptyState
            title="Nothing on radar yet"
            body="Add a product and DropHawk will watch every retailer that carries it."
            action={
              <Button
                testID="radar-add-watch"
                label="Add a watch"
                onPress={() => router.push('/add-watch')}
              />
            }
          />
        </Panel>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerIcons: { flexDirection: 'row', gap: space.sm },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sys: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
