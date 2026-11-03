/**
 * Object storage settings, read from the AWS-standard variables that Neon
 * injects (and that real AWS, MinIO or R2 understand just as well):
 *
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION   required as a group
 *   AWS_ENDPOINT_URL_S3   optional; set for Neon or another S3-compatible
 *                         store, left out for real AWS S3
 *   STORAGE_BUCKET        optional; defaults to "assets", the bucket neon.ts
 *                         declares
 *
 * Storage is optional. Local dev and CI run with none of it set, and the API
 * still boots. Half a configuration is treated as a mistake and stops the
 * process at boot: a deploy missing its secret key should fail loudly, not
 * come up healthy and break on the first upload.
 */

export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');

export const DEFAULT_STORAGE_BUCKET = 'assets';

/** The three variables that switch storage on. All or none. */
export const REQUIRED_STORAGE_VARIABLES = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
] as const;

export interface EnabledStorageConfig {
  enabled: true;
  region: string;
  /** Absent means real AWS S3, addressed virtual-host style. */
  endpoint?: string;
  bucket: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
}

export interface DisabledStorageConfig {
  enabled: false;
}

export type StorageConfig = EnabledStorageConfig | DisabledStorageConfig;

export type EnvLookup = (name: string) => string | undefined;

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

/**
 * Accepts either a lookup function (ConfigService.get) or a plain record
 * (process.env), so the API and the standalone smoke script share one reading
 * of the rules.
 */
export function readStorageConfig(
  source: EnvLookup | Record<string, string | undefined>,
): StorageConfig {
  const lookup: EnvLookup =
    typeof source === 'function' ? source : (name) => source[name];

  // An empty value counts as unset. .env.test blanks these on purpose, and a
  // KEY= line copied from .env.example should not half-enable storage.
  const read = (name: string): string | undefined => {
    const value = lookup(name)?.trim();
    return value ? value : undefined;
  };

  const accessKeyId = read('AWS_ACCESS_KEY_ID');
  const secretAccessKey = read('AWS_SECRET_ACCESS_KEY');
  const region = read('AWS_REGION');

  if (!accessKeyId && !secretAccessKey && !region) {
    return { enabled: false };
  }

  if (!accessKeyId || !secretAccessKey || !region) {
    const missing = REQUIRED_STORAGE_VARIABLES.filter((name) => !read(name));
    // Names only, never values: this message ends up in deploy logs.
    throw new StorageConfigError(
      `Object storage is half-configured. Missing: ${missing.join(', ')}. ` +
        `Set all of ${REQUIRED_STORAGE_VARIABLES.join(', ')}, or none of them ` +
        'to run without storage.',
    );
  }

  const endpoint = read('AWS_ENDPOINT_URL_S3');
  if (endpoint !== undefined && !isHttpUrl(endpoint)) {
    throw new StorageConfigError(
      'AWS_ENDPOINT_URL_S3 must be an http(s) URL, such as the endpoint Neon ' +
        'prints for the branch. Leave it unset for real AWS S3.',
    );
  }

  return {
    enabled: true,
    region,
    endpoint,
    bucket: read('STORAGE_BUCKET') ?? DEFAULT_STORAGE_BUCKET,
    credentials: { accessKeyId, secretAccessKey },
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
