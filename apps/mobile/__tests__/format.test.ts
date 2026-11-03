import { formatDuration, timeAgo } from '@/lib/format';
import { ringColor, ringLabel, ringProgress } from '@/components/CountdownRing';
import { stepPath } from '@/components/Sparkline';
import { colors } from '@/lib/theme';

describe('format helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(47)).toBe('0:47');
    expect(formatDuration(725)).toBe('12:05');
    expect(formatDuration(3753)).toBe('1:02:33');
    expect(formatDuration(-5)).toBe('0:00');
  });
  it('formats relative time', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(timeAgo('2026-11-01T11:59:48Z', now)).toBe('12s ago');
    expect(timeAgo('2026-11-01T11:56:00Z', now)).toBe('4m ago');
    expect(timeAgo('2026-11-01T09:00:00Z', now)).toBe('3h ago');
    expect(timeAgo(null, now)).toBe('never');
  });
});

describe('CountdownRing', () => {
  it('changes colour at thresholds', () => {
    expect(ringColor(600)).toBe(colors.accent);
    expect(ringColor(30)).toBe(colors.dead);
    expect(ringColor(0)).toBe(colors.live);
  });
  it('clamps progress', () => {
    expect(ringProgress(450, 900)).toBe(0.5);
    expect(ringProgress(5000, 900)).toBe(1);
    expect(ringProgress(-10, 900)).toBe(0);
  });
  it('labels long and short waits', () => {
    expect(ringLabel(521)).toBe('8:41');
    expect(ringLabel(7200)).toBe('2h');
    expect(ringLabel(200000)).toBe('2d');
    expect(ringLabel(0)).toBe('LIVE');
  });
});

describe('Sparkline stepPath', () => {
  it('raises the line during in-stock periods', () => {
    const d = stepPath(
      [
        { at: 50, inStock: true },
        { at: 75, inStock: false },
      ],
      0,
      100,
      200,
      28,
    );
    expect(d).toBe('M0 25 L100.0 25 L100.0 3 L150.0 3 L150.0 25 L200 25');
  });
});
