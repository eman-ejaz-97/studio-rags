import { ENQUIRY_RECEIVED } from '../../src/enquiries/enquiries.controller';
import type { ErrorBody } from '../utils/auth';
import { useTestApp } from '../utils/test-app';

const CONTACT = '/api/v1/contact';

const enquiry = (overrides: Record<string, unknown> = {}) => ({
  name: '  Mary Jones ',
  email: ' Mary@Example.com ',
  message: 'Do you have a batik class in December?',
  ...overrides,
});

describe('POST /api/v1/contact', () => {
  const ctx = useTestApp();

  it('stores a general enquiry, tidied, without signing in', async () => {
    const t = ctx();

    const res = await t.http().post(CONTACT).send(enquiry()).expect(202);

    expect(res.body).toEqual({ message: ENQUIRY_RECEIVED });
    const rows = await t.prisma.enquiry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'GENERAL',
      name: 'Mary Jones',
      email: 'mary@example.com',
      phone: null,
      message: 'Do you have a batik class in December?',
      preferredDate: null,
      guestCount: null,
      handledAt: null,
    });
  });

  it('keeps the date and guest count for a private event', async () => {
    const t = ctx();

    await t
      .http()
      .post(CONTACT)
      .send(
        enquiry({
          kind: 'PRIVATE_EVENT',
          preferredDate: '2027-01-16',
          guestCount: 12,
        }),
      )
      .expect(202);

    const [row] = await t.prisma.enquiry.findMany();
    expect(row.kind).toBe('PRIVATE_EVENT');
    expect(row.preferredDate?.toISOString()).toBe('2027-01-16T00:00:00.000Z');
    expect(row.guestCount).toBe(12);
  });

  it('drops event details sent with a general enquiry', async () => {
    const t = ctx();

    await t
      .http()
      .post(CONTACT)
      .send(enquiry({ preferredDate: '2027-01-16', guestCount: 12 }))
      .expect(202);

    const [row] = await t.prisma.enquiry.findMany();
    expect(row).toMatchObject({ preferredDate: null, guestCount: null });
  });

  it('answers a filled honeypot exactly like a real enquiry, and stores nothing', async () => {
    const t = ctx();

    const res = await t
      .http()
      .post(CONTACT)
      .send(enquiry({ website: 'https://spam.example' }))
      .expect(202);

    expect(res.body).toEqual({ message: ENQUIRY_RECEIVED });
    expect(await t.prisma.enquiry.count()).toBe(0);
  });

  it('explains each problem in words', async () => {
    const res = await ctx()
      .http()
      .post(CONTACT)
      .send({ name: ' ', email: 'not-an-email', message: 'hi' })
      .expect(400);

    expect((res.body as ErrorBody).message).toEqual(
      expect.arrayContaining([
        'Enter your name',
        'Enter a valid email address',
        'Tell us a little more: at least 10 characters',
      ]),
    );
  });

  it('refuses fields it does not know', async () => {
    const t = ctx();

    await t
      .http()
      .post(CONTACT)
      .send(enquiry({ handledAt: '2026-01-01' }))
      .expect(400);

    expect(await t.prisma.enquiry.count()).toBe(0);
  });

  it('allows five enquiries per ten minutes from one address', async () => {
    const t = ctx();
    for (let i = 1; i <= 5; i++) {
      const res = await t.http().post(CONTACT).send(enquiry());
      expect({ attempt: i, status: res.status }).toEqual({
        attempt: i,
        status: 202,
      });
    }

    const blocked = await t.http().post(CONTACT).send(enquiry());

    expect(blocked.status).toBe(429);
    expect(await t.prisma.enquiry.count()).toBe(5);
  });
});
