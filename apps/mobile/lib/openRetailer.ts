import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import type { RetailerState } from './api';

/**
 * Affiliate tags where a program exists and tagging is a plain URL parameter.
 * Amazon Associates: `tag=`. Other retailers' programs (Impact, CJ) use tracking redirects that
 * are configured per account, so they are added here once those accounts exist.
 */
export function withAffiliate(
  url: string,
  amazonTag = process.env.EXPO_PUBLIC_AMAZON_ASSOCIATE_TAG,
) {
  try {
    const u = new URL(url);
    if (amazonTag && /(^|\.)amazon\.com$/.test(u.hostname) && !u.searchParams.has('tag')) {
      u.searchParams.set('tag', amazonTag);
      return u.toString();
    }
  } catch {
    // not a URL we can tag
  }
  return url;
}

/**
 * Open a retailer product page. Universal links open the retailer's app when installed;
 * otherwise we fall back to the in-app browser.
 */
export async function openRetailer(r: Pick<RetailerState, 'url'>) {
  if (!r.url) return;
  const url = withAffiliate(r.url);
  try {
    const opened = await Linking.openURL(url)
      .then(() => true)
      .catch(() => false);
    if (!opened) await WebBrowser.openBrowserAsync(url);
  } catch {
    await WebBrowser.openBrowserAsync(url);
  }
}
