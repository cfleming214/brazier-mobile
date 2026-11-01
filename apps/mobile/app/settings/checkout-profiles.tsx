import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Button, Panel, Screen, T } from '@/components/ui';
import {
  useCheckoutProfiles,
  useDeleteCheckoutProfile,
  useSaveCheckoutProfile,
} from '@/hooks/useCheckoutProfiles';
import { CheckoutProfile, newProfileId } from '@/lib/checkoutProfile';
import { colors, fonts, radius, space } from '@/lib/theme';

type Draft = Record<keyof Omit<CheckoutProfile, 'id'>, string> & { id: string };

const FIELDS: {
  key: keyof Omit<Draft, 'id'>;
  label: string;
  keyboard?: 'email-address' | 'phone-pad';
}[] = [
  { key: 'label', label: 'Profile name (e.g. Home)' },
  { key: 'fullName', label: 'Full name' },
  { key: 'email', label: 'Email', keyboard: 'email-address' },
  { key: 'phone', label: 'Phone', keyboard: 'phone-pad' },
  { key: 'address1', label: 'Address' },
  { key: 'address2', label: 'Apt / Unit (optional)' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'State' },
  { key: 'postalCode', label: 'ZIP' },
  { key: 'country', label: 'Country (2 letters)' },
];

const blank = (): Draft => ({
  id: newProfileId(),
  label: '',
  fullName: '',
  email: '',
  phone: '',
  address1: '',
  address2: '',
  city: '',
  region: '',
  postalCode: '',
  country: 'US',
});

/** Checkout profiles (DROP-50): stored only in this device's secure storage. */
export default function CheckoutProfiles() {
  const { data: profiles = [] } = useCheckoutProfiles();
  const save = useSaveCheckoutProfile();
  const remove = useDeleteCheckoutProfile();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSave() {
    if (!draft) return;
    const parsed = CheckoutProfile.safeParse(draft);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    try {
      await save.mutateAsync(parsed.data);
      setDraft(null);
      setErrors({});
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : 'Could not save.' });
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <T variant="mono" style={{ color: colors.accent }}>
            ← BACK
          </T>
        </Pressable>
        <T variant="display">CHECKOUT PROFILES</T>
        <T variant="muted">
          Saved only on this device and never uploaded. Card details are not stored — pay with your
          retailer account, Apple Pay or Google Pay.
        </T>

        {draft ? (
          <Panel title={profiles.some((p) => p.id === draft.id) ? 'Edit profile' : 'New profile'}>
            <View style={{ gap: space.sm }}>
              {FIELDS.map((f) => (
                <View key={f.key}>
                  <TextInput
                    testID={`profile-${f.key}`}
                    placeholder={f.label}
                    placeholderTextColor={colors.muted}
                    value={draft[f.key]}
                    onChangeText={(v) => setDraft({ ...draft, [f.key]: v })}
                    keyboardType={f.keyboard}
                    autoCapitalize={f.key === 'email' ? 'none' : 'words'}
                    autoComplete="off"
                    style={[styles.input, errors[f.key] && { borderColor: colors.dead }]}
                  />
                  {errors[f.key] ? (
                    <T style={{ color: colors.dead, fontSize: 12 }}>{errors[f.key]}</T>
                  ) : null}
                </View>
              ))}
              {errors.form ? <T style={{ color: colors.dead }}>{errors.form}</T> : null}
              <Button
                testID="profile-save"
                label="Save profile"
                loading={save.isPending}
                onPress={onSave}
              />
              <Button variant="ghost" label="Cancel" onPress={() => setDraft(null)} />
            </View>
          </Panel>
        ) : (
          <>
            {profiles.map((p) => (
              <Panel key={p.id} title={p.label}>
                <T variant="mono" style={{ color: colors.muted }}>
                  {p.fullName} · {p.city}, {p.region}
                </T>
                <View style={styles.row}>
                  <Button
                    variant="ghost"
                    label="Edit"
                    onPress={() => setDraft({ ...p, address2: p.address2 ?? '' } as Draft)}
                  />
                  <Button
                    variant="ghost"
                    label="Delete"
                    onPress={() =>
                      Alert.alert('Delete profile?', p.label, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => remove.mutate(p.id),
                        },
                      ])
                    }
                  />
                </View>
              </Panel>
            ))}
            <Button testID="profile-add" label="Add profile" onPress={() => setDraft(blank())} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    color: colors.ink,
    fontFamily: fonts.body,
    backgroundColor: colors.field,
  },
});
