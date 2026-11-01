import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteProfile,
  loadProfiles,
  PROFILE_LIMIT,
  saveProfile,
  type CheckoutProfile,
} from '@/lib/checkoutProfile';
import { accountKeys, useMyProfile } from '@/lib/queries';

/**
 * Device-only data: never persisted by the query cache persister (see queryClient.tsx),
 * read straight from secure storage.
 */
export function useCheckoutProfiles() {
  return useQuery({
    queryKey: accountKeys.checkoutProfiles,
    queryFn: loadProfiles,
    staleTime: Infinity,
    meta: { persist: false },
  });
}

export function useSaveCheckoutProfile() {
  const qc = useQueryClient();
  const { data: me } = useMyProfile();
  const limit = (me?.plan ?? 'free') === 'free' ? PROFILE_LIMIT.free : PROFILE_LIMIT.pro;
  return useMutation({
    mutationFn: (p: CheckoutProfile) => saveProfile(p, limit),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.checkoutProfiles }),
  });
}

export function useDeleteCheckoutProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProfile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.checkoutProfiles }),
  });
}
