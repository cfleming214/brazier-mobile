import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { T } from '@/components/ui';
import { formatDuration } from '@/lib/format';
import { colors } from '@/lib/theme';

export interface CountdownRingProps {
  /** Seconds remaining. */
  secondsLeft: number;
  /** Seconds the full ring represents (default 15 minutes). */
  totalSeconds?: number;
  size?: number;
  stroke?: number;
  testID?: string;
}

/** Colour by urgency: amber normally, red inside 60s, green once it's started. */
export function ringColor(secondsLeft: number): string {
  if (secondsLeft <= 0) return colors.live;
  if (secondsLeft <= 60) return colors.dead;
  return colors.accent;
}

/** Fraction of the ring that is filled (0..1). */
export function ringProgress(secondsLeft: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, secondsLeft / totalSeconds));
}

export function ringLabel(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'LIVE';
  if (secondsLeft >= 86_400) return `${Math.floor(secondsLeft / 86_400)}d`;
  if (secondsLeft >= 3600) return `${Math.floor(secondsLeft / 3600)}h`;
  return formatDuration(secondsLeft);
}

export function CountdownRing({
  secondsLeft,
  totalSeconds = 900,
  size = 64,
  stroke = 5,
  testID,
}: CountdownRingProps) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = ringProgress(secondsLeft, totalSeconds);
  const color = ringColor(secondsLeft);
  return (
    <View
      style={{ width: size, height: size }}
      testID={testID}
      accessibilityLabel={`Starts in ${ringLabel(secondsLeft)}`}
    >
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.line}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <T variant="mono" style={{ fontSize: 12, color }}>
          {ringLabel(secondsLeft)}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
