// Nest loads this at startup; a spec using class-transformer alone must too.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBookingDto, toBookingRequest } from './create-booking.dto';

/** As the global ValidationPipe does it: transform, then validate. */
async function parse(body: object) {
  const dto = plainToInstance(CreateBookingDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

const base = { sessionId: 'session_1', seats: 2, photoConsentOptOut: false };

describe('CreateBookingDto', () => {
  it('trims names and notes, and turns blank notes into none', async () => {
    const { dto, errors } = await parse({
      ...base,
      notes: '   ',
      attendees: [
        { firstName: '  Sam ', age: 8 },
        { firstName: 'Noor', age: 9 },
      ],
    });

    expect(errors).toEqual([]);
    expect(toBookingRequest(dto)).toEqual({
      sessionId: 'session_1',
      seats: 2,
      attendees: [
        { firstName: 'Sam', age: 8 },
        { firstName: 'Noor', age: 9 },
      ],
      photoConsentOptOut: false,
      notes: null,
    });
  });

  it('gives an empty attendee list when none is sent', async () => {
    const { dto } = await parse(base);

    expect(toBookingRequest(dto).attendees).toEqual([]);
  });

  it('refuses a field inside an attendee that it does not know', async () => {
    const { errors } = await parse({
      ...base,
      attendees: [{ firstName: 'Sam', age: 8, allergies: 'none' }],
    });

    expect(JSON.stringify(errors)).toContain('allergies');
  });
});
