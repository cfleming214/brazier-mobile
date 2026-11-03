import { StyleSheet, View } from 'react-native';
import { T } from '@/components/ui';
import { retailerCodes } from '@/lib/format';
import type { AdapterHealth } from '@/lib/telemetry';
import { colors, fonts, space } from '@/lib/theme';

const statusColor: Record<AdapterHealth['status'], string> = {
  ok: colors.live,
  degraded: colors.warn,
  backoff: colors.warn,
  down: colors.dead,
  disabled: colors.muted,
  unknown: colors.muted,
};

const protectionLabel = (p: string) =>
  p.startsWith('limit:')
    ? `LIMIT ${p.slice(6)}`
    : ((
        {
          queue: 'QUEUE',
          captcha: 'VERIFY',
          app_only: 'APP ONLY',
          in_store_only: 'IN STORE',
          raffle: 'RAFFLE',
          signin_required: 'SIGN IN',
          ratelimit: 'SLOWED',
          blocked: 'BLOCKED',
        } as Record<string, string>
      )[p] ?? p.toUpperCase());

/** One cell per retailer: status dot, latency, and any active protection (DROP-40, DROP-91). */
export function AdapterGrid({ health }: { health: AdapterHealth[] }) {
  const shown = health.filter((h) => h.retailer_id !== 'tcgplayer');
  return (
    <View style={styles.grid} testID="adapter-grid">
      {shown.map((h) => {
        const color = statusColor[h.status];
        const sub = h.active_protections[0]
          ? protectionLabel(h.active_protections[0])
          : h.status === 'backoff'
            ? 'BACKOFF'
            : h.status === 'disabled'
              ? 'OFF'
              : h.latency_ms != null
                ? `${h.latency_ms}ms`
                : '—';
        return (
          <View
            key={h.retailer_id}
            style={[
              styles.cell,
              (h.status === 'backoff' || h.active_protections.length > 0) && {
                borderColor: '#4a2e18',
              },
              h.status === 'disabled' && { opacity: 0.5 },
            ]}
            testID={`adapter-${h.retailer_id}`}
          >
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <T variant="mono" style={{ fontFamily: fonts.monoSemi, fontSize: 11 }}>
                {retailerCodes[h.retailer_id]}
              </T>
            </View>
            <T
              variant="mono"
              style={{
                fontSize: 9,
                color:
                  h.active_protections.length || h.status === 'backoff'
                    ? colors.warn
                    : colors.muted,
              }}
            >
              {sub}
            </T>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  cell: {
    flexGrow: 1,
    flexBasis: '15%',
    minWidth: 48,
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 6,
    gap: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

export { space };
