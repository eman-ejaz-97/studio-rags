import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { EnabledStorageConfig } from './storage.config';
import {
  InvalidStorageKeyError,
  MAX_PRESIGN_SECONDS,
  StorageNotConfiguredError,
  StorageService,
} from './storage.service';

// Every test stubs the client's one network entry point. Presigning signs
// locally and never calls send, so those tests run the real SDK code.
let send: jest.SpyInstance;

beforeEach(() => {
  send = jest.spyOn(S3Client.prototype, 'send').mockImplementation(() => {
    throw new Error('Unexpected network call in a unit test');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const neon: EnabledStorageConfig = {
  enabled: true,
  region: 'ap-southeast-1',
  endpoint: 'http://storage.test:9000',
  bucket: 'assets',
  credentials: { accessKeyId: 'AKIDTEST', secretAccessKey: 'test-secret' },
};

const aws: EnabledStorageConfig = {
  enabled: true,
  region: 'ap-southeast-2',
  bucket: 'assets',
  credentials: { accessKeyId: 'AKIDTEST', secretAccessKey: 'test-secret' },
};

/** The arguments send() received on its nth call. */
function sendCall(n = 0): unknown[] {
  return (send.mock.calls as unknown[][])[n];
}

/** The command object handed to send() on its nth call. */
function sentCommand(n = 0): unknown {
  return sendCall(n)[0];
}

describe('StorageService', () => {
  describe('when not configured', () => {
    const storage = new StorageService({ enabled: false });

    it('reports itself disabled', () => {
      expect(storage.isEnabled()).toBe(false);
    });

    it.each([
      ['put', () => storage.put('a.txt', 'x', 'text/plain')],
      ['get', () => storage.get('a.txt')],
      ['exists', () => storage.exists('a.txt')],
      ['delete', () => storage.delete('a.txt')],
      ['presignGet', () => storage.presignGet('a.txt')],
      ['ping', () => storage.ping()],
    ])('%s rejects with StorageNotConfiguredError', async (_name, call) => {
      await expect(call()).rejects.toBeInstanceOf(StorageNotConfiguredError);
      expect(send).not.toHaveBeenCalled();
    });

    it('names the variables to set, but no values', async () => {
      await expect(storage.ping()).rejects.toThrow(
        /AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION/,
      );
    });

    it('shuts down cleanly with no client to close', () => {
      expect(() => storage.onModuleDestroy()).not.toThrow();
    });
  });

  describe('when configured', () => {
    it('reports itself enabled', () => {
      expect(new StorageService(neon).isEnabled()).toBe(true);
    });

    describe('put', () => {
      it('sends a PutObject with the body, type and cache policy', async () => {
        send.mockResolvedValue({});
        const body = Buffer.from('hello');

        await new StorageService(neon).put(
          'workshops/batik/cover.jpg',
          body,
          'image/jpeg',
          'public, max-age=31536000, immutable',
        );

        expect(sentCommand()).toBeInstanceOf(PutObjectCommand);
        expect((sentCommand() as PutObjectCommand).input).toEqual({
          Bucket: 'assets',
          Key: 'workshops/batik/cover.jpg',
          Body: body,
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        });
      });

      it('leaves the cache policy unset when none is given', async () => {
        send.mockResolvedValue({});

        await new StorageService(neon).put('a.txt', 'x', 'text/plain');

        expect(
          (sentCommand() as PutObjectCommand).input.CacheControl,
        ).toBeUndefined();
      });

      it('passes a storage failure straight back to the caller', async () => {
        send.mockRejectedValue(
          Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }),
        );

        await expect(
          new StorageService(neon).put('a.txt', 'x', 'text/plain'),
        ).rejects.toThrow('Access Denied');
      });
    });

    describe('get', () => {
      it('returns the whole body as a Buffer', async () => {
        send.mockResolvedValue({
          Body: {
            transformToByteArray: () =>
              Promise.resolve(new TextEncoder().encode('hello')),
          },
        });

        const result = await new StorageService(neon).get('a.txt');

        expect(Buffer.isBuffer(result)).toBe(true);
        expect(result.toString('utf8')).toBe('hello');
        expect(sentCommand()).toBeInstanceOf(GetObjectCommand);
        expect((sentCommand() as GetObjectCommand).input).toEqual({
          Bucket: 'assets',
          Key: 'a.txt',
        });
      });

      it('throws rather than returning nothing when there is no body', async () => {
        send.mockResolvedValue({});

        await expect(new StorageService(neon).get('a.txt')).rejects.toThrow(
          /no body/,
        );
      });
    });

    describe('exists', () => {
      it('is true when HeadObject succeeds', async () => {
        send.mockResolvedValue({});

        await expect(new StorageService(neon).exists('a.txt')).resolves.toBe(
          true,
        );
        expect(sentCommand()).toBeInstanceOf(HeadObjectCommand);
        expect((sentCommand() as HeadObjectCommand).input).toEqual({
          Bucket: 'assets',
          Key: 'a.txt',
        });
      });

      it.each([
        [
          'NotFound with a 404',
          { name: 'NotFound', $metadata: { httpStatusCode: 404 } },
        ],
        ['a bare 404', { name: 'Unknown', $metadata: { httpStatusCode: 404 } }],
        ['NoSuchKey', { name: 'NoSuchKey', $metadata: {} }],
      ])('is false on %s', async (_label, fields) => {
        send.mockRejectedValue(Object.assign(new Error('missing'), fields));

        await expect(new StorageService(neon).exists('a.txt')).resolves.toBe(
          false,
        );
      });

      it('rethrows anything that is not "not found"', async () => {
        // A 403 means the credentials are wrong, not that the object is
        // missing. Answering false would hide a broken deploy.
        send.mockRejectedValue(
          Object.assign(new Error('Forbidden'), {
            name: 'Forbidden',
            $metadata: { httpStatusCode: 403 },
          }),
        );

        await expect(new StorageService(neon).exists('a.txt')).rejects.toThrow(
          'Forbidden',
        );
      });
    });

    describe('delete', () => {
      it('sends a DeleteObject for the key', async () => {
        send.mockResolvedValue({});

        await new StorageService(neon).delete('smoke/a.txt');

        expect(sentCommand()).toBeInstanceOf(DeleteObjectCommand);
        expect((sentCommand() as DeleteObjectCommand).input).toEqual({
          Bucket: 'assets',
          Key: 'smoke/a.txt',
        });
      });
    });

    describe('ping', () => {
      it('sends a HeadBucket for the configured bucket, with a timeout', async () => {
        send.mockResolvedValue({});

        await new StorageService(neon).ping(1234);

        expect(sentCommand()).toBeInstanceOf(HeadBucketCommand);
        expect((sentCommand() as HeadBucketCommand).input).toEqual({
          Bucket: 'assets',
        });
        const options = sendCall()[1] as { abortSignal: AbortSignal };
        expect(options.abortSignal).toBeInstanceOf(AbortSignal);
        expect(options.abortSignal.aborted).toBe(false);
      });

      it('rejects when the bucket cannot be reached', async () => {
        send.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

        await expect(new StorageService(neon).ping()).rejects.toThrow(
          'ENOTFOUND',
        );
      });
    });

    describe('presignGet', () => {
      it('signs a path-style URL against a custom endpoint, as Neon requires', async () => {
        const url = new URL(
          await new StorageService(neon).presignGet('workshops/batik/a b.jpg'),
        );

        expect(url.origin).toBe('http://storage.test:9000');
        expect(url.pathname).toBe('/assets/workshops/batik/a%20b.jpg');
        expect(url.searchParams.get('X-Amz-Algorithm')).toBe(
          'AWS4-HMAC-SHA256',
        );
        expect(url.searchParams.get('X-Amz-Credential')).toMatch(
          /^AKIDTEST\/\d{8}\/ap-southeast-1\/s3\/aws4_request$/,
        );
        expect(url.searchParams.get('X-Amz-Signature')).toMatch(
          /^[0-9a-f]{64}$/,
        );
        // Signed locally: nothing went over the network.
        expect(send).not.toHaveBeenCalled();
      });

      it('signs a virtual-host URL on real AWS, where no endpoint is set', async () => {
        const url = new URL(
          await new StorageService(aws).presignGet('workshops/a.jpg'),
        );

        expect(url.hostname).toBe('assets.s3.ap-southeast-2.amazonaws.com');
        expect(url.pathname).toBe('/workshops/a.jpg');
      });

      it('expires in an hour by default', async () => {
        const url = new URL(await new StorageService(neon).presignGet('a.txt'));

        expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
      });

      it('caps the expiry at seven days, the SigV4 maximum', async () => {
        const url = new URL(
          await new StorageService(neon).presignGet('a.txt', 30 * 24 * 3600),
        );

        expect(MAX_PRESIGN_SECONDS).toBe(604_800);
        expect(url.searchParams.get('X-Amz-Expires')).toBe('604800');
      });

      it('rounds a fractional expiry down to whole seconds', async () => {
        const url = new URL(
          await new StorageService(neon).presignGet('a.txt', 90.9),
        );

        expect(url.searchParams.get('X-Amz-Expires')).toBe('90');
      });

      it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'refuses an expiry of %p',
        async (seconds) => {
          await expect(
            new StorageService(neon).presignGet('a.txt', seconds),
          ).rejects.toBeInstanceOf(RangeError);
        },
      );
    });

    describe('key validation', () => {
      const storage = () => new StorageService(neon);

      it.each([
        ['an empty key', ''],
        ['a leading slash', '/workshops/a.jpg'],
        ['a ".." segment', 'workshops/../secrets.txt'],
        ['a leading ".." segment', '../x'],
        ['a lone ".."', '..'],
        ['a trailing ".." segment', 'workshops/..'],
        ['more than 1024 bytes', 'x'.repeat(1025)],
        // 513 two-byte characters: under 1024 characters, over 1024 bytes.
        ['more than 1024 bytes of UTF-8', 'é'.repeat(513)],
      ])('rejects %s before anything is sent', async (_label, key) => {
        // Each call starts only when its turn comes. Started all at once, a
        // failing first expectation would leave the other four rejections
        // unhandled, and Node would kill the whole Jest run without saying
        // which test failed.
        const calls: [string, () => Promise<unknown>][] = [
          ['put', () => storage().put(key, 'x', 'text/plain')],
          ['get', () => storage().get(key)],
          ['exists', () => storage().exists(key)],
          ['delete', () => storage().delete(key)],
          ['presignGet', () => storage().presignGet(key)],
        ];

        for (const [method, call] of calls) {
          const error = await call().then(
            () => undefined,
            (rejected: unknown) => rejected,
          );
          expect({ method, error }).toEqual({
            method,
            error: expect.any(InvalidStorageKeyError) as unknown,
          });
        }
        expect(send).not.toHaveBeenCalled();
      });

      it.each([
        ['a plain key', 'a.txt'],
        ['dots inside a name', 'workshops/batik..v2/a.jpg'],
        ['exactly 1024 bytes', 'x'.repeat(1024)],
      ])('accepts %s', async (_label, key) => {
        send.mockResolvedValue({});

        await expect(storage().delete(key)).resolves.toBeUndefined();
      });
    });

    it('closes the client when the module shuts down', () => {
      const destroy = jest.spyOn(S3Client.prototype, 'destroy');

      new StorageService(neon).onModuleDestroy();

      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });
});
