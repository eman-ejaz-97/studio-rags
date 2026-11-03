import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';

/** SigV4 presigned URLs cannot outlive seven days; S3 rejects longer ones. */
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_PRESIGN_SECONDS = 60 * 60;
/** S3's own key limit, measured in UTF-8 bytes rather than characters. */
export const MAX_KEY_BYTES = 1024;
/** How long ping() waits before calling the bucket unreachable. */
export const DEFAULT_PING_TIMEOUT_MS = 5_000;

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Object storage is not configured. Set AWS_ACCESS_KEY_ID, ' +
        'AWS_SECRET_ACCESS_KEY and AWS_REGION (plus AWS_ENDPOINT_URL_S3 for ' +
        'Neon or another S3-compatible store) to enable it.',
    );
    this.name = 'StorageNotConfiguredError';
  }
}

export class InvalidStorageKeyError extends Error {
  constructor(reason: string) {
    super(`Invalid storage key: ${reason}`);
    this.name = 'InvalidStorageKeyError';
  }
}

export type StorageBody = Buffer | Uint8Array | string;

/**
 * A thin wrapper over one S3 bucket. Callers store the object key in Postgres
 * (never the bytes) and hand browsers a presigned URL, because the bucket is
 * private.
 *
 * Plain AWS SDK v3, so the same code runs against Neon today and real S3 if
 * the project later moves to AWS: only the environment changes.
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly client: S3Client | null;
  private readonly bucket: string | null;

  constructor(@Inject(STORAGE_CONFIG) config: StorageConfig) {
    if (!config.enabled) {
      this.client = null;
      this.bucket = null;
      return;
    }

    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Neon only accepts path-style requests (endpoint/bucket/key). Real AWS
      // prefers virtual-host style (bucket.s3.region.amazonaws.com), so the
      // switch follows the endpoint rather than being hard-wired on.
      forcePathStyle: Boolean(config.endpoint),
      // Passed explicitly rather than left to the SDK's default chain, so the
      // values validated in storage.config.ts are the ones actually used and
      // a stray ~/.aws profile can never be picked up instead.
      credentials: config.credentials,
    });
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async put(
    key: string,
    body: StorageBody,
    contentType: string,
    cacheControl?: string,
  ): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: assertValidKey(key),
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const { client, bucket } = this.require();
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: assertValidKey(key) }),
    );
    if (!res.Body) {
      throw new Error(`Storage returned no body for "${key}".`);
    }
    // Reading the stream to the end also releases the socket. An unread body
    // keeps it checked out of the pool.
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async exists(key: string): Promise<boolean> {
    const { client, bucket } = this.require();
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: assertValidKey(key) }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /** Idempotent, as in S3: deleting a missing key is not an error. */
  async delete(key: string): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: assertValidKey(key) }),
    );
  }

  /**
   * A time-limited GET link for a private object. Signed locally with the
   * secret key: no request reaches the bucket, so this works (and returns a
   * URL) even for a key that does not exist yet.
   */
  async presignGet(
    key: string,
    expiresInSeconds = DEFAULT_PRESIGN_SECONDS,
  ): Promise<string> {
    const { client, bucket } = this.require();
    const validKey = assertValidKey(key);
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds < 1) {
      throw new RangeError(
        'presignGet expiry must be a positive number of seconds.',
      );
    }
    const expiresIn = Math.min(
      Math.floor(expiresInSeconds),
      MAX_PRESIGN_SECONDS,
    );

    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: validKey }),
      { expiresIn },
    );
  }

  /**
   * Proves the credentials, endpoint and bucket all work, using the cheapest
   * authenticated call S3 has. Rejects on any failure, including a timeout.
   */
  async ping(timeoutMs = DEFAULT_PING_TIMEOUT_MS): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(new HeadBucketCommand({ Bucket: bucket }), {
      // Cancels the socket as well as the wait, so a hung endpoint cannot pile
      // up open requests behind repeated health checks.
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
  }

  onModuleDestroy(): void {
    // Closes the keep-alive sockets, so app.close() really lets the process
    // exit instead of waiting for idle connections to time out.
    this.client?.destroy();
  }

  private require(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new StorageNotConfiguredError();
    }
    return { client: this.client, bucket: this.bucket };
  }
}

/**
 * Rejects keys that would surprise S3 or a later reader. A leading slash
 * produces a different key from the same name without one, and a ".."
 * segment is harmless to S3 itself but dangerous the moment a key is ever
 * mapped onto a filesystem path, a CDN rule or a local mirror.
 */
export function assertValidKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidStorageKeyError('the key is empty.');
  }
  if (key.startsWith('/')) {
    throw new InvalidStorageKeyError('the key must not start with "/".');
  }
  if (key.split('/').includes('..')) {
    throw new InvalidStorageKeyError(
      'the key must not contain a ".." segment.',
    );
  }
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new InvalidStorageKeyError(
      `the key is longer than ${MAX_KEY_BYTES} bytes.`,
    );
  }
  return key;
}

/** A HEAD has no body, so the SDK can only name the error from the status. */
function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { name, $metadata } = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    $metadata?.httpStatusCode === 404 ||
    name === 'NotFound' ||
    name === 'NoSuchKey'
  );
}
