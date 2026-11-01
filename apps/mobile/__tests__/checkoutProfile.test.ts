import * as SecureStore from 'expo-secure-store';
import {
  clearProfiles,
  copyFields,
  deleteProfile,
  loadProfiles,
  PROFILE_LIMIT,
  ProfileLimitError,
  saveProfile,
} from '@/lib/checkoutProfile';

const base = {
  id: 'p1',
  label: 'Home',
  fullName: 'Ash Ketchum',
  email: 'ash@example.com',
  phone: '+1 555 010 0199',
  address1: '1 Pallet Rd',
  address2: '',
  city: 'Pallet',
  region: 'KS',
  postalCode: '66002',
  country: 'US',
};

describe('checkout profiles (device-only)', () => {
  beforeEach(async () => {
    (SecureStore as unknown as { __reset: () => void }).__reset();
  });

  it('round-trips through secure storage with device-only accessibility', async () => {
    await saveProfile(base);
    expect(await loadProfiles()).toEqual([base]);
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });

  it('updates in place, deletes and clears', async () => {
    await saveProfile(base);
    await saveProfile({ ...base, label: 'Work' });
    expect((await loadProfiles()).map((p) => p.label)).toEqual(['Work']);
    await saveProfile({ ...base, id: 'p2' }, PROFILE_LIMIT.pro);
    await deleteProfile('p1');
    expect((await loadProfiles()).map((p) => p.id)).toEqual(['p2']);
    await clearProfiles();
    expect(await loadProfiles()).toEqual([]);
  });

  it('rejects invalid details and has no card fields', async () => {
    await expect(saveProfile({ ...base, email: 'nope' })).rejects.toThrow();
    await expect(saveProfile({ ...base, postalCode: '!' })).rejects.toThrow();
    const saved = await saveProfile({ ...base, cardNumber: '4242424242424242' });
    expect(saved).not.toHaveProperty('cardNumber');
  });

  it('allows one profile on Free and many on Pro', async () => {
    await saveProfile(base);
    await expect(saveProfile({ ...base, id: 'p2' })).rejects.toBeInstanceOf(ProfileLimitError);
    for (let i = 2; i <= PROFILE_LIMIT.pro; i++)
      await saveProfile({ ...base, id: `p${i}` }, PROFILE_LIMIT.pro);
    await expect(saveProfile({ ...base, id: 'p99' }, PROFILE_LIMIT.pro)).rejects.toThrow(
      /up to 25/,
    );
  });

  it('ignores corrupt storage', async () => {
    await SecureStore.setItemAsync('drophawk.checkoutProfiles.v1', '{not json');
    expect(await loadProfiles()).toEqual([]);
  });

  it('builds copy chips in checkout order, skipping empty fields', () => {
    expect(copyFields(base).map((f) => f.key)).toEqual([
      'fullName',
      'email',
      'phone',
      'address1',
      'city',
      'region',
      'postalCode',
    ]);
  });
});
