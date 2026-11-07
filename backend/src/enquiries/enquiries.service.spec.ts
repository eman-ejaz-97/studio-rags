import { EnquiryKind } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EnquiriesService } from './enquiries.service';

function setup() {
  const create = jest.fn().mockResolvedValue({});
  const prisma = { enquiry: { create } } as unknown as PrismaService;
  return { service: new EnquiriesService(prisma), create };
}

const base = {
  name: 'Mary Jones',
  email: 'mary@example.com',
  message: 'Do you have a batik class in December?',
};

describe('EnquiriesService.create', () => {
  it('stores a general enquiry and drops event-only fields', async () => {
    const { service, create } = setup();

    await expect(
      service.create({ ...base, preferredDate: '2027-01-16', guestCount: 9 }),
    ).resolves.toBe('stored');

    expect(create).toHaveBeenCalledWith({
      data: {
        kind: EnquiryKind.GENERAL,
        ...base,
        phone: null,
        preferredDate: null,
        guestCount: null,
      },
    });
  });

  it('keeps event fields on a private-event enquiry', async () => {
    const { service, create } = setup();

    await service.create({
      ...base,
      kind: EnquiryKind.PRIVATE_EVENT,
      phone: '0400 000 000',
      preferredDate: '2027-01-16',
      guestCount: 12,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: EnquiryKind.PRIVATE_EVENT,
        phone: '0400 000 000',
        preferredDate: new Date('2027-01-16'),
        guestCount: 12,
      }) as unknown,
    });
  });

  it('stores an empty phone as null, not as an empty string', async () => {
    const { service, create } = setup();

    await service.create({ ...base, phone: '' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ phone: null }) as unknown,
    });
  });

  it('discards a filled honeypot without touching the database', async () => {
    const { service, create } = setup();

    await expect(
      service.create({ ...base, website: 'https://spam.example' }),
    ).resolves.toBe('discarded');

    expect(create).not.toHaveBeenCalled();
  });
});
