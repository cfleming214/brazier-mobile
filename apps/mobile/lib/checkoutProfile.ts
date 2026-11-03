import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

/**
 * Checkout profiles live only on this device (iOS Keychain / Android Keystore via expo-secure-store).
 * They are never sent to Brazier servers. Card numbers are deliberately NOT stored here: payment
 * stays with the retailer account, Apple Pay or Google Pay. Profiles hold the details people type
 * at checkout so the Checkout Sheet can offer one-tap copy chips.
 */
export const CheckoutProfile = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s().-]{6,19}$/, 'Enter a valid phone number'),
  address1: z.string().trim().min(1).max(120),
  address2: z.string().trim().max(120).default(''),
  city: z.string().trim().min(1).max(60),
  region: z.string().trim().min(2).max(40),
  postalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 -]{3,10}$/, 'Enter a valid postal code'),
  country: z.string().trim().length(2).default('US'),
});
export type CheckoutProfile = z.infer<typeof CheckoutProfile>;

const KEY = 'brazier.checkoutProfiles.v1';
/** Free plan: one profile. Pro: effectively unlimited (a sanity cap keeps secure storage small). */
export const PROFILE_LIMIT = { free: 1, pro: 25 } as const;

export async function loadProfiles(): Promise<CheckoutProfile[]> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return [];
  try {
    const parsed = z.array(CheckoutProfile).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

async function persist(profiles: CheckoutProfile[]) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(profiles), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function saveProfile(
  input: unknown,
  maxProfiles: number = PROFILE_LIMIT.free,
): Promise<CheckoutProfile> {
  const profile = CheckoutProfile.parse(input);
  const profiles = await loadProfiles();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile;
  else if (profiles.length >= maxProfiles) throw new ProfileLimitError(maxProfiles);
  else profiles.push(profile);
  await persist(profiles);
  return profile;
}

export class ProfileLimitError extends Error {
  constructor(readonly limit: number) {
    super(
      limit === PROFILE_LIMIT.free
        ? 'The free plan saves one checkout profile. Upgrade to Pro for more.'
        : `You can save up to ${limit} profiles.`,
    );
  }
}

export async function deleteProfile(id: string) {
  await persist((await loadProfiles()).filter((p) => p.id !== id));
}

export async function clearProfiles() {
  await SecureStore.deleteItemAsync(KEY);
}

export const newProfileId = () =>
  `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Copy chips shown in the Checkout Sheet, in the order retailers usually ask for them. */
export function copyFields(p: CheckoutProfile): { key: string; label: string; value: string }[] {
  return [
    { key: 'fullName', label: 'Name', value: p.fullName },
    { key: 'email', label: 'Email', value: p.email },
    { key: 'phone', label: 'Phone', value: p.phone },
    { key: 'address1', label: 'Address', value: p.address1 },
    { key: 'address2', label: 'Apt / Unit', value: p.address2 },
    { key: 'city', label: 'City', value: p.city },
    { key: 'region', label: 'State', value: p.region },
    { key: 'postalCode', label: 'ZIP', value: p.postalCode },
  ].filter((f) => f.value.length > 0);
}
