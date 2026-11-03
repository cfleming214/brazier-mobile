import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { AlertPermissionGate } from '@/components/AlertPermissionGate';
import { Button, Panel, Screen, T } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, space } from '@/lib/theme';

interface Prefs {
  restock: boolean;
  bot_status: boolean;
  drop_updates: boolean;
  reminders: boolean;
  community: boolean;
  drop_updates_digest: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  quiet_allows_urgent: boolean;
  timezone: string;
}

const DEFAULTS: Prefs = {
  restock: true,
  bot_status: true,
  drop_updates: true,
  reminders: true,
  community: true,
  drop_updates_digest: false,
  quiet_hours_enabled: false,
  quiet_start: '23:00',
  quiet_end: '07:00',
  quiet_allows_urgent: true,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/New_York',
};

const rows: { key: keyof Prefs; title: string; body: string }[] = [
  { key: 'restock', title: 'Restock alerts', body: 'Something you watch is in stock.' },
  {
    key: 'bot_status',
    title: 'Bot status',
    body: 'Armed, Ready to buy, Your turn, login expired, retailer queues and limits.',
  },
  {
    key: 'drop_updates',
    title: 'Drop updates',
    body: 'New drops, date changes, preorders opening, price changes.',
  },
  { key: 'reminders', title: 'Reminders', body: 'Calendar reminders you set.' },
  { key: 'community', title: 'Community', body: 'Sightings and squad posts.' },
];

/** Notification settings (DROP-88). Enforced server-side by the notifier. */
export default function NotificationSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_prefs').select('*').maybeSingle();
      if (error) throw error;
      return { ...DEFAULTS, ...(data ?? {}) } as Prefs;
    },
  });
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (data)
      setPrefs({
        ...data,
        quiet_start: data.quiet_start.slice(0, 5),
        quiet_end: data.quiet_end.slice(0, 5),
      });
  }, [data]);

  async function save(next: Prefs) {
    setPrefs(next);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase
      .from('notification_prefs')
      .upsert({ ...next, user_id: u.user.id }, { onConflict: 'user_id' });
    setSaved(error ? 'Could not save. Check your connection.' : 'Saved');
    qc.invalidateQueries({ queryKey: ['notification-prefs'] });
  }

  const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable onPress={() => router.back()}>
          <T variant="mono" style={{ color: colors.accent }}>
            ← PROFILE
          </T>
        </Pressable>
        <T variant="display">NOTIFICATIONS</T>
        <AlertPermissionGate />

        <Panel title="Send me">
          {rows.map((r) => (
            <View key={r.key} style={styles.row}>
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: fonts.bodyMedium }}>{r.title}</T>
                <T variant="muted" style={{ fontSize: 12 }}>
                  {r.body}
                </T>
              </View>
              <Switch
                testID={`pref-${r.key}`}
                value={prefs[r.key] as boolean}
                onValueChange={(v) => save({ ...prefs, [r.key]: v })}
                trackColor={{ true: colors.accent, false: colors.line }}
              />
            </View>
          ))}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: fonts.bodyMedium }}>Daily digest for drop updates</T>
              <T variant="muted" style={{ fontSize: 12 }}>
                One summary a day instead of each update. Preorder openings still come right away.
              </T>
            </View>
            <Switch
              testID="pref-digest"
              value={prefs.drop_updates_digest}
              onValueChange={(v) => save({ ...prefs, drop_updates_digest: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
        </Panel>

        <Panel title="Quiet hours">
          <View style={styles.row}>
            <T style={{ flex: 1 }}>Silence notifications overnight</T>
            <Switch
              testID="pref-quiet"
              value={prefs.quiet_hours_enabled}
              onValueChange={(v) => save({ ...prefs, quiet_hours_enabled: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
          {prefs.quiet_hours_enabled ? (
            <>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                {(['quiet_start', 'quiet_end'] as const).map((k) => (
                  <View key={k} style={{ flex: 1, gap: 4 }}>
                    <T variant="label">{k === 'quiet_start' ? 'From' : 'Until'}</T>
                    <TextInput
                      value={prefs[k]}
                      onChangeText={(t) => setPrefs({ ...prefs, [k]: t })}
                      onEndEditing={() =>
                        validTime(prefs[k])
                          ? save(prefs)
                          : setSaved('Use 24-hour time, like 23:00.')
                      }
                      placeholder="23:00"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                    />
                  </View>
                ))}
              </View>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <T>Let urgent alerts through</T>
                  <T variant="muted" style={{ fontSize: 12 }}>
                    Restocks, Ready to buy and Your turn still ring during quiet hours.
                  </T>
                </View>
                <Switch
                  testID="pref-urgent"
                  value={prefs.quiet_allows_urgent}
                  onValueChange={(v) => save({ ...prefs, quiet_allows_urgent: v })}
                  trackColor={{ true: colors.accent, false: colors.line }}
                />
              </View>
              <T variant="muted" style={{ fontSize: 12 }}>
                Time zone: {prefs.timezone}
              </T>
            </>
          ) : null}
        </Panel>
        {saved ? (
          <T variant="muted" testID="prefs-saved">
            {saved}
          </T>
        ) : null}
        <Button label="Done" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  input: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.ink,
    fontFamily: fonts.mono,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
});
