import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colors } from '@/lib/theme';

export interface StockPoint {
  at: number; // epoch ms
  inStock: boolean;
}

/** Build a step path where in-stock periods are raised. Exported for tests. */
export function stepPath(
  points: StockPoint[],
  from: number,
  to: number,
  width: number,
  height: number,
): string {
  const span = Math.max(1, to - from);
  const x = (t: number) => ((Math.min(Math.max(t, from), to) - from) / span) * width;
  const yUp = 3;
  const yDown = height - 3;
  let state = false;
  let d = `M0 ${yDown}`;
  for (const p of [...points].sort((a, b) => a.at - b.at)) {
    if (p.inStock === state) continue;
    const px = x(p.at).toFixed(1);
    d += ` L${px} ${state ? yUp : yDown} L${px} ${p.inStock ? yUp : yDown}`;
    state = p.inStock;
  }
  d += ` L${width} ${state ? yUp : yDown}`;
  return d;
}

export function Sparkline({
  points,
  days = 14,
  width = 200,
  height = 28,
  color = colors.live,
  now = Date.now(),
}: {
  points: StockPoint[];
  days?: number;
  width?: number;
  height?: number;
  color?: string;
  now?: number;
}) {
  const from = now - days * 86_400_000;
  const d = stepPath(points, from, now, width, height);
  const last = [...points].sort((a, b) => a.at - b.at).at(-1);
  const grid = Array.from({ length: Math.floor(days / 4) + 1 }, (_, i) => (i * 4 * width) / days);
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {grid.map((gx) => (
        <Line key={gx} x1={gx} x2={gx} y1={0} y2={height} stroke={colors.line} strokeWidth={1} />
      ))}
      <Path d={`${d} L${width} ${height} L0 ${height} Z`} fill={color} opacity={0.14} />
      <Path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      <Circle cx={width - 2} cy={last?.inStock ? 3 : height - 3} r={3} fill={color} />
    </Svg>
  );
}
