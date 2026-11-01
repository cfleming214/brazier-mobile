import { StyleSheet, View } from 'react-native';
import { T } from '@/components/ui';
import { retailerCodes } from '@/lib/format';
import type { ActivityEvent } from '@/lib/telemetry';
import { colors } from '@/lib/theme';

const kindColor: Record<ActivityEvent['kind'], string> = {
  in_stock: colors.live,
  out_of_stock: colors.dead,
  suppressed: colors.warn,
  flap: colors.warn,
  push: colors.accent,
  poll: colors.watch,
  protection: colors.warn,
  error: colors.dead,
};

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/** Raw poll, detect, suppress and push events, newest first (DROP-40). */
export function EventStream({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0)
    return <T variant="muted">Events appear here as DropHawk checks your watches.</T>;
  return (
    <View testID="event-stream">
      {events.slice(0, 12).map((e) => (
        <T key={e.id} variant="mono" style={styles.line} numberOfLines={1}>
          <T variant="mono" style={{ color: '#566a7e', fontSize: 10 }}>
            {clock(e.created_at)}{' '}
          </T>
          <T variant="mono" style={{ fontSize: 10 }}>
            {e.retailer_id ? retailerCodes[e.retailer_id].padEnd(4) : 'SYS '}
          </T>
          <T variant="mono" style={{ color: kindColor[e.kind], fontSize: 10 }}>
            {e.message}
          </T>
        </T>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ line: { lineHeight: 17, fontSize: 10 } });
