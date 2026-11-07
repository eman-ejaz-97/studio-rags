import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_RANGE_DAYS,
  MAX_RANGE_DAYS,
  resolveRange,
} from './session-range.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-07T12:00:00.000Z');

describe('resolveRange', () => {
  it('defaults to now and the following 31 days', () => {
    const { from, to } = resolveRange({}, now);

    expect(from).toEqual(now);
    expect(to.getTime() - from.getTime()).toBe(DEFAULT_RANGE_DAYS * DAY_MS);
  });

  it('measures the default end from the given start', () => {
    const { to } = resolveRange({ from: '2026-12-01T00:00:00+10:30' }, now);

    expect(to.toISOString()).toBe('2026-12-31T13:30:00.000Z');
  });

  it('keeps an explicit window, offsets included', () => {
    const { from, to } = resolveRange(
      { from: '2026-12-01T00:00:00+10:30', to: '2027-01-01T00:00:00+10:30' },
      now,
    );

    expect(from.toISOString()).toBe('2026-11-30T13:30:00.000Z');
    expect(to.toISOString()).toBe('2026-12-31T13:30:00.000Z');
  });

  it('accepts exactly the maximum window', () => {
    const to = new Date(now.getTime() + MAX_RANGE_DAYS * DAY_MS).toISOString();

    expect(() => resolveRange({ to }, now)).not.toThrow();
  });

  it.each([
    ['an empty window', { from: '2026-12-01', to: '2026-12-01' }],
    ['a reversed window', { from: '2026-12-02', to: '2026-12-01' }],
    ['one day over the maximum', { from: '2026-12-01', to: '2027-03-04' }],
  ])('refuses %s', (_, dto) => {
    expect(() => resolveRange(dto, now)).toThrow(BadRequestException);
  });
});
