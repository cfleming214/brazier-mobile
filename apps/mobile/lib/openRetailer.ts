import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import type { RetailerState } from './api';

/**
 * Open a retailer product page. Universal links open the retailer's app when installed;
 * otherwise we fall back to the in-app browser. The full Checkout Sheet lands in DROP-51.
 */
export async function openRetailer(r: Pick<RetailerState, 'url'>) {
  if (!r.url) return;
  try {
    const opened = await Linking.openURL(r.url)
      .then(() => true)
      .catch(() => false);
    if (!opened) await WebBrowser.openBrowserAsync(r.url);
  } catch {
    await WebBrowser.openBrowserAsync(r.url);
  }
}
