import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { EmptyState, Panel, Screen, T } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { routeForNotification } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { useInbox, type InboxItem } from '@/lib/telemetry';
import { useQueryClient } from '@tanstack/react-query';
import { colors, fonts, space } from '@/lib/theme';

const categories: { key: InboxItem['category'] | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'restock', label: 'Restocks' },
  { key: 'bot_status', label: 'Bot' },
  { key: 'drop_updates', label: 'Drops' },
  { key: 'reminders', label: 'Reminders' },
];

const categoryColor: Record<InboxItem['category'], string> = {
  restock: colors.live,
  bot_status: colors.accent,
  drop_updates: colors.watch,
  reminders: colors.watch,
  community: colors.muted,
};

/** Inbox of every notification sent, even ones swiped away or never pushed (DROP-89). */
export default function Notifications() {
  const { data: items = [] } = useInbox();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof categories)[number]['key']>('all');
  const shown = filter === 'all' ? items : items.filter((i) => i.category === filter);
  const unread = items.filter((i) => !i.read_at).length;

  const groups = useMemo(() => {
    const today = new Date().toDateString();
    return {
      today: shown.filter((i) => new Date(i.created_at).toDateString() === today),
      earlier: shown.filter((i) => new Date(i.created_at).toDateString() !== today),
    };
  }, [shown]);

  async function open(i: InboxItem) {
    if (!i.read_at) {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', i.id);
      qc.invalidateQueries({ queryKey: ['inbox'] });
    }
    const route = routeForNotification(i.data, 'default');
    if (route && route !== '/notifications') router.push(route as never);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <T variant="mono" style={{ color: colors.accent }}>
              ← BACK
            </T>
          </Pressable>
          {unread > 0 ? (
            <Pressable
              testID="mark-all-read"
              onPress={async () => {
                await supabase.rpc('mark_all_notifications_read');
                qc.invalidateQueries({ queryKey: ['inbox'] });
              }}
            >
              <T variant="mono" style={{ color: colors.accent }}>
                MARK ALL READ
              </T>
            </Pressable>
          ) : null}
        </View>
        <T variant="display">NOTIFICATIONS</T>
        <View style={styles.chips}>
          {categories.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => setFilter(c.key)}
              style={[styles.chip, filter === c.key && styles.chipOn]}
              testID={`inbox-filter-${c.key}`}
            >
              <T style={{ fontSize: 12, color: filter === c.key ? colors.accentInk : colors.ink }}>
                {c.label}
              </T>
            </Pressable>
          ))}
        </View>
        {shown.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            body="Restock alerts, bot updates and drop news will collect here."
          />
        ) : (
          (['today', 'earlier'] as const).map((g) =>
            groups[g].length ? (
              <Panel key={g} title={g === 'today' ? 'Today' : 'Earlier'}>
                {groups[g].map((i) => (
                  <Pressable
                    key={i.id}
                    testID={`inbox-item-${i.id}`}
                    onPress={() => open(i)}
                    style={styles.item}
                  >
                    <View style={[styles.bar, { backgroundColor: categoryColor[i.category] }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T style={{ fontFamily: i.read_at ? fonts.body : fonts.bodySemi }}>
                        {i.title}
                      </T>
                      <T variant="muted" style={{ fontSize: 13 }}>
                        {i.body}
                      </T>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <T variant="mono" style={{ color: colors.muted, fontSize: 10 }}>
                        {timeAgo(i.created_at)}
                      </T>
                      {!i.read_at ? <View style={styles.unread} /> : null}
                    </View>
                  </Pressable>
                ))}
              </Panel>
            ) : null,
          )
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  item: {
    flexDirection: 'row',
    gap: space.sm,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  bar: { width: 3, borderRadius: 2 },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
