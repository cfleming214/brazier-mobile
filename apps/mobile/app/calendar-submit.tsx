import type { RetailerSlug } from '@drophawk/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Button, Panel, Screen, T } from '@/components/ui';
import { parseLocalDateTime, submitDrop, type AgendaEvent } from '@/lib/calendar';
import { retailerNames, WATCHABLE_RETAILERS } from '@/lib/format';
import { colors, fonts, radius, space } from '@/lib/theme';

const TYPES: { key: AgendaEvent['event_type']; label: string }[] = [
  { key: 'preorder_open', label: 'Preorder' },
  { key: 'restock_window', label: 'Restock' },
  { key: 'retailer_street_date', label: 'In stores' },
  { key: 'set_release', label: 'Set release' },
  { key: 'prerelease', label: 'Prerelease' },
];

/** Community drop submission (DROP-44). Shows as rumored until an official source confirms it. */
export default function SubmitDrop() {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AgendaEvent['event_type']>('preorder_open');
  const [retailer, setRetailer] = useState<RetailerSlug | null>(null);
  const [when, setWhen] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (title.trim().length < 3) return setError('Give the drop a short title.');
    const startsAt = parseLocalDateTime(when);
    if (!startsAt)
      return setError(
        'Enter the date as YYYY-MM-DD, optionally with a time like 2026-11-07 03:00.',
      );
    if (url && !/^https?:\/\//.test(url.trim()))
      return setError('The source link should start with https://');
    setBusy(true);
    try {
      await submitDrop({
        title: title.trim(),
        event_type: type,
        retailer_id: retailer,
        starts_at: startsAt,
        source_url: url.trim() || null,
        note: note.trim() || null,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <View style={{ padding: space.xl, gap: space.md, flex: 1, justifyContent: 'center' }}>
          <T variant="title">Thanks for the tip</T>
          <T variant="muted">
            It will show as rumored once reviewed, and as confirmed when an official source matches
            it.
          </T>
          <Button label="Back to calendar" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()}>
          <T variant="mono" style={{ color: colors.accent }}>
            ← CALENDAR
          </T>
        </Pressable>
        <T variant="display">SUGGEST A DROP</T>
        <Panel>
          <T variant="label">What's dropping</T>
          <TextInput
            testID="submit-title"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Mega Evolution ETB preorder"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <T variant="label">Type</T>
          <View style={styles.chips}>
            {TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setType(t.key)}
                style={[styles.chip, type === t.key && styles.chipOn]}
              >
                <T style={{ fontSize: 12, color: type === t.key ? colors.accentInk : colors.ink }}>
                  {t.label}
                </T>
              </Pressable>
            ))}
          </View>
          <T variant="label">Retailer (optional)</T>
          <View style={styles.chips}>
            {WATCHABLE_RETAILERS.map((r) => (
              <Pressable
                key={r}
                onPress={() => setRetailer(retailer === r ? null : r)}
                style={[styles.chip, retailer === r && styles.chipOn]}
              >
                <T style={{ fontSize: 12, color: retailer === r ? colors.accentInk : colors.ink }}>
                  {retailerNames[r]}
                </T>
              </Pressable>
            ))}
          </View>
          <T variant="label">When (your local time)</T>
          <TextInput
            testID="submit-when"
            value={when}
            onChangeText={setWhen}
            placeholder="2026-11-07 03:00"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoCapitalize="none"
          />
          <T variant="label">Source link (optional)</T>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="url"
          />
          <T variant="label">Note (optional)</T>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Where did you hear about it?"
            placeholderTextColor={colors.muted}
            style={[styles.input, { minHeight: 70 }]}
            multiline
            maxLength={500}
          />
        </Panel>
        {error ? (
          <T testID="submit-error" style={{ color: colors.dead }}>
            {error}
          </T>
        ) : null}
        <Button testID="submit-drop" label="Submit" loading={busy} onPress={submit} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  input: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 15,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
