import type { RetailerSlug } from '@drophawk/shared';
import { colors } from './theme';

export const retailerNames: Record<RetailerSlug, string> = {
  bestbuy: 'Best Buy',
  target: 'Target',
  walmart: 'Walmart',
  gamestop: 'GameStop',
  pokemoncenter: 'Pokémon Center',
  amazon: 'Amazon',
  tcgplayer: 'TCGplayer',
};

export const retailerCodes: Record<RetailerSlug, string> = {
  bestbuy: 'BBY',
  target: 'TGT',
  walmart: 'WMT',
  gamestop: 'GME',
  pokemoncenter: 'PKC',
  amazon: 'AMZ',
  tcgplayer: 'TCG',
};

/** Retailers a user can watch for restocks (TCGplayer is a marketplace, used for comps). */
export const WATCHABLE_RETAILERS: RetailerSlug[] = [
  'bestbuy',
  'target',
  'walmart',
  'gamestop',
  'pokemoncenter',
  'amazon',
];

/** "12s ago", "4m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "0:47", "12:05", "1:02:33". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const statusColor = {
  live: colors.live,
  monitoring: colors.watch,
  sold_out: colors.dead,
} as const;

export const pollTierLabel = { cold: '5m', normal: '1m', hot: '30s', burst: 'BURST 5s' } as const;
