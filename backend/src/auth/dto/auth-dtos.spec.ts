import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { ForgotPasswordDto } from './forgot-password.dto';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';
import { ResetPasswordDto } from './reset-password.dto';

/**
 * Runs a request body through the same two steps, with the same options, as
 * the global ValidationPipe in app.setup.ts: transform without implicit
 * conversion, then validate with whitelist and forbidNonWhitelisted.
 */
async function check<T extends object>(
  dto: ClassConstructor<T>,
  body: Record<string, unknown>,
) {
  const instance = plainToInstance(dto, body, {
    enableImplicitConversion: false,
  });
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    instance,
    errors,
    /** The failed constraints for one property, keyed by constraint name. */
    failed: (property: string) =>
      errors.find((e) => e.property === property)?.constraints ?? {},
  };
}

const PASSWORD_MESSAGE = 'Password must be at least 10 characters';
const PASSWORD_MAX_MESSAGE = 'Password must be at most 128 characters';

describe('auth DTOs', () => {
  describe('RegisterDto', () => {
    const valid = {
      email: 'jane@example.com',
      password: 'correct horse battery',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    it('accepts a well-formed body', async () => {
      const { errors } = await check(RegisterDto, valid);
      expect(errors).toEqual([]);
    });

    it('trims and lower-cases the email, matching how it is stored', async () => {
      const { instance, errors } = await check(RegisterDto, {
        ...valid,
        email: '  Jane.Doe@Example.COM \n',
      });

      expect(errors).toEqual([]);
      expect(instance.email).toBe('jane.doe@example.com');
    });

    it.each(['not-an-email', 'jane@', '', 42])(
      'rejects the email %p with a readable message',
      async (email) => {
        const { failed } = await check(RegisterDto, { ...valid, email });
        expect(failed('email')).toEqual({
          isEmail: 'Enter a valid email address',
        });
      },
    );

    it('rejects a 9-character password with the stated message', async () => {
      const { failed } = await check(RegisterDto, {
        ...valid,
        password: 'a'.repeat(9),
      });
      expect(failed('password')).toEqual({ minLength: PASSWORD_MESSAGE });
    });

    it.each([10, 128])('accepts a %d-character password', async (length) => {
      const { errors } = await check(RegisterDto, {
        ...valid,
        password: 'a'.repeat(length),
      });
      expect(errors).toEqual([]);
    });

    it('rejects a password over 128 characters, saying it is too long', async () => {
      // Bounds the argon2 work an anonymous request can cause. The message
      // must name the maximum: "at least 10" for a 129-character password
      // would send the user the wrong way.
      const { failed } = await check(RegisterDto, {
        ...valid,
        password: 'a'.repeat(129),
      });
      expect(failed('password')).toEqual({ maxLength: PASSWORD_MAX_MESSAGE });
    });

    it('rejects a password that is not a string, with no implicit conversion', async () => {
      const { failed } = await check(RegisterDto, {
        ...valid,
        password: 12345678901,
      });
      expect(failed('password')).toHaveProperty('isString');
    });

    it('trims the names', async () => {
      const { instance, errors } = await check(RegisterDto, {
        ...valid,
        firstName: '  Jane ',
        lastName: '\tDoe  ',
      });

      expect(errors).toEqual([]);
      expect(instance.firstName).toBe('Jane');
      expect(instance.lastName).toBe('Doe');
    });

    it.each(['firstName', 'lastName'])('requires %s', async (field) => {
      const missing: Record<string, unknown> = { ...valid };
      delete missing[field];

      const { failed } = await check(RegisterDto, missing);

      expect(Object.keys(failed(field)).length).toBeGreaterThan(0);
    });

    it.each(['firstName', 'lastName'])(
      'treats an all-whitespace %s as missing',
      async (field) => {
        const { failed } = await check(RegisterDto, {
          ...valid,
          [field]: '    ',
        });
        expect(failed(field)).toHaveProperty('isLength');
      },
    );

    it('rejects a name over 80 characters', async () => {
      const { failed } = await check(RegisterDto, {
        ...valid,
        firstName: 'a'.repeat(81),
      });
      expect(failed('firstName')).toHaveProperty('isLength');
    });

    it('accepts marketingConsent as a real boolean', async () => {
      const { instance, errors } = await check(RegisterDto, {
        ...valid,
        marketingConsent: true,
      });
      expect(errors).toEqual([]);
      expect(instance.marketingConsent).toBe(true);
    });

    it.each(['true', 1, 'yes'])(
      'rejects marketingConsent %p, so consent is never inferred (FR-M2)',
      async (marketingConsent) => {
        const { failed } = await check(RegisterDto, {
          ...valid,
          marketingConsent,
        });
        expect(failed('marketingConsent')).toHaveProperty('isBoolean');
      },
    );

    it('allows phone to be left out but caps it at 40 characters', async () => {
      expect((await check(RegisterDto, valid)).errors).toEqual([]);
      const { failed } = await check(RegisterDto, {
        ...valid,
        phone: '0'.repeat(41),
      });
      expect(failed('phone')).toHaveProperty('maxLength');
    });

    it('rejects a smuggled role, so nobody can sign themselves up as an admin', async () => {
      const { failed } = await check(RegisterDto, { ...valid, role: 'ADMIN' });
      expect(failed('role')).toEqual({
        whitelistValidation: 'property role should not exist',
      });
    });
  });

  describe('LoginDto', () => {
    it('trims and lower-cases the email, so the lookup matches the stored form', async () => {
      const { instance, errors } = await check(LoginDto, {
        email: ' JANE@Example.com ',
        password: 'whatever-they-typed',
      });

      expect(errors).toEqual([]);
      expect(instance.email).toBe('jane@example.com');
    });

    it('rejects an invalid email', async () => {
      const { failed } = await check(LoginDto, {
        email: 'jane',
        password: 'whatever-they-typed',
      });
      expect(failed('email')).toEqual({
        isEmail: 'Enter a valid email address',
      });
    });

    it('caps the password at 128 characters and requires a string', async () => {
      const tooLong = await check(LoginDto, {
        email: 'jane@example.com',
        password: 'a'.repeat(129),
      });
      const notString = await check(LoginDto, {
        email: 'jane@example.com',
        password: { $ne: '' },
      });

      expect(tooLong.failed('password')).toHaveProperty('maxLength');
      expect(notString.failed('password')).toHaveProperty('isString');
    });
  });

  describe('ForgotPasswordDto', () => {
    it('trims and lower-cases the email', async () => {
      const { instance, errors } = await check(ForgotPasswordDto, {
        email: '  Jane@EXAMPLE.com',
      });

      expect(errors).toEqual([]);
      expect(instance.email).toBe('jane@example.com');
    });

    it.each([{ email: 'nope' }, {}])('rejects %p', async (body) => {
      const { failed } = await check(ForgotPasswordDto, body);
      expect(failed('email')).toHaveProperty('isEmail');
    });
  });

  describe('ResetPasswordDto', () => {
    // Generated exactly as TokenService.randomToken() does: 43 base64url chars.
    const issuedToken = randomBytes(32).toString('base64url');

    it('accepts a token as issued and a valid password', async () => {
      const { errors } = await check(ResetPasswordDto, {
        token: issuedToken,
        password: 'new password 123',
      });
      expect(errors).toEqual([]);
    });

    it.each([
      [9, false],
      [10, true],
      [512, true],
      [513, false],
    ])('token of %d characters accepted: %p', async (length, accepted) => {
      const { failed } = await check(ResetPasswordDto, {
        token: 'a'.repeat(length),
        password: 'new password 123',
      });
      expect(Object.keys(failed('token')).length === 0).toBe(accepted);
    });

    it('rejects a short password with the stated message', async () => {
      const { failed } = await check(ResetPasswordDto, {
        token: issuedToken,
        password: 'short',
      });
      expect(failed('password')).toEqual({ minLength: PASSWORD_MESSAGE });
    });

    it('rejects a password over 128 characters, saying it is too long', async () => {
      const { failed } = await check(ResetPasswordDto, {
        token: issuedToken,
        password: 'a'.repeat(129),
      });
      expect(failed('password')).toEqual({ maxLength: PASSWORD_MAX_MESSAGE });
    });

    it.each([10, 128])('accepts a %d-character password', async (length) => {
      const { errors } = await check(ResetPasswordDto, {
        token: issuedToken,
        password: 'a'.repeat(length),
      });
      expect(errors).toEqual([]);
    });
  });
});
