import { describe, expect, it } from 'vitest';
import { formatCents, parsePriceToCents } from '../money';

describe('formatCents', () => {
  it('formats dollars and cents', () => {
    expect(formatCents(5999)).toBe('$59.99');
    expect(formatCents(100)).toBe('$1.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456)).toBe('$1,234.56');
  });
  it('handles negatives and null', () => {
    expect(formatCents(-250)).toBe('-$2.50');
    expect(formatCents(null)).toBe('—');
  });
});

describe('parsePriceToCents', () => {
  it('parses common inputs', () => {
    expect(parsePriceToCents('59.99')).toBe(5999);
    expect(parsePriceToCents('$60')).toBe(6000);
    expect(parsePriceToCents('1,200.5')).toBe(120050);
  });
  it('rejects invalid input', () => {
    expect(parsePriceToCents('abc')).toBeNull();
    expect(parsePriceToCents('1.234')).toBeNull();
    expect(parsePriceToCents('')).toBeNull();
  });
});
