import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteProfile,
  loadProfiles,
  saveProfile,
  type CheckoutProfile,
} from '@/lib/checkoutProfile';
import { accountKeys } from '@/lib/queries';

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
  return useMutation({
    mutationFn: (p: CheckoutProfile) => saveProfile(p),
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
