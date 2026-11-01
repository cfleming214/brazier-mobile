import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases';
import type { Plan } from './api';

/**
 * RevenueCat wrapper (DROP-52). The app user id is the Supabase user id, so the RevenueCat webhook
 * (supabase/functions/revenuecat-webhook) can set profiles.plan server-side. The server is the
 * source of truth for limits; the client entitlement only drives UI.
 */
const apiKey =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

export const purchasesEnabled = !!apiKey && Platform.OS !== 'web';
export const PRO_ENTITLEMENT = 'pro';

let configuredFor: string | null = null;

export async function configurePurchases(userId: string | null) {
  if (!purchasesEnabled || !userId) return;
  if (configuredFor === null) {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: apiKey!, appUserID: userId });
  } else if (configuredFor !== userId) {
    await Purchases.logIn(userId);
  }
  configuredFor = userId;
}

export async function resetPurchases() {
  if (!purchasesEnabled || configuredFor === null) return;
  await Purchases.logOut().catch(() => {});
  configuredFor = null;
}

export interface PaywallOffer {
  id: string;
  title: string;
  price: string;
  period: 'monthly' | 'annual' | 'other';
  pkg: PurchasesPackage | null;
}

/** Fallback copy when RevenueCat isn't configured (dev builds, web) so the paywall still renders. */
export const FALLBACK_OFFERS: PaywallOffer[] = [
  { id: 'pro_monthly', title: 'Pro · Monthly', price: '$6.99', period: 'monthly', pkg: null },
  { id: 'pro_annual', title: 'Pro · Annual', price: '$49.99', period: 'annual', pkg: null },
];

export async function loadOffers(): Promise<PaywallOffer[]> {
  if (!purchasesEnabled) return FALLBACK_OFFERS;
  const offerings = await Purchases.getOfferings();
  const pkgs = offerings.current?.availablePackages ?? [];
  if (pkgs.length === 0) return FALLBACK_OFFERS;
  return pkgs.map((p) => ({
    id: p.identifier,
    title: p.product.title,
    price: p.product.priceString,
    period:
      p.packageType === 'MONTHLY' ? 'monthly' : p.packageType === 'ANNUAL' ? 'annual' : 'other',
    pkg: p,
  }));
}

export type PurchaseOutcome = 'purchased' | 'cancelled' | 'unavailable';

export async function purchase(offer: PaywallOffer): Promise<PurchaseOutcome> {
  if (!purchasesEnabled || !offer.pkg) return 'unavailable';
  try {
    const { customerInfo } = await Purchases.purchasePackage(offer.pkg);
    return customerInfo.entitlements.active[PRO_ENTITLEMENT] ? 'purchased' : 'cancelled';
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return 'cancelled';
    throw e;
  }
}

export async function restore(): Promise<boolean> {
  if (!purchasesEnabled) return false;
  const info = await Purchases.restorePurchases();
  return !!info.entitlements.active[PRO_ENTITLEMENT];
}

export const planLabel: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  pro_squad: 'Pro Squad',
};
