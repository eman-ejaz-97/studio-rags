import {
  REFERENCE_ALPHABET,
  REFERENCE_PATTERN,
  newBookingReference,
  normaliseReference,
} from './booking-reference';

describe('newBookingReference', () => {
  it('is SR- and five symbols from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      expect(newBookingReference()).toMatch(REFERENCE_PATTERN);
    }
  });

  it('never uses the characters people misread', () => {
    expect(REFERENCE_ALPHABET).toHaveLength(30);
    for (const confusable of ['0', 'O', '1', 'I', 'L', 'U']) {
      expect(REFERENCE_ALPHABET).not.toContain(confusable);
    }
  });

  it('draws from the whole alphabet rather than a corner of it', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      for (const c of newBookingReference().slice(3)) seen.add(c);
    }
    // 2,500 draws over 30 symbols: missing one by chance is ~1e-36.
    expect(seen.size).toBe(30);
  });
});

describe('normaliseReference', () => {
  it.each([
    ['SR-7K4M2', 'SR-7K4M2'],
    ['sr-7k4m2', 'SR-7K4M2'],
    ['  SR-7K4M2 ', 'SR-7K4M2'],
  ])('reads %p as %p', (input, expected) => {
    expect(normaliseReference(input)).toBe(expected);
  });

  it.each(['SR-7K4M', 'SR-7K4M22', 'SR-7K4M0', 'XX-7K4M2', '', 'SR-7K4M2;'])(
    'refuses %p without asking the database',
    (input) => {
      expect(normaliseReference(input)).toBeNull();
    },
  );
});
