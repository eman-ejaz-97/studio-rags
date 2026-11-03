import {
  DEFAULT_STORAGE_BUCKET,
  StorageConfigError,
  readStorageConfig,
} from './storage.config';

const FULL = {
  AWS_ACCESS_KEY_ID: 'AKIDTEST',
  AWS_SECRET_ACCESS_KEY: 'secret-value-that-must-never-be-printed',
  AWS_REGION: 'ap-southeast-1',
};

describe('readStorageConfig', () => {
  it('is disabled when none of the three variables is set', () => {
    expect(readStorageConfig({})).toEqual({ enabled: false });
  });

  it('treats empty and blank values as unset', () => {
    // .env.test blanks them on purpose; a copied KEY= line looks the same.
    expect(
      readStorageConfig({
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '   ',
        AWS_REGION: '',
        AWS_ENDPOINT_URL_S3: '',
      }),
    ).toEqual({ enabled: false });
  });

  it('ignores an endpoint or bucket on their own: they do not switch it on', () => {
    expect(
      readStorageConfig({
        AWS_ENDPOINT_URL_S3: 'https://storage.example.com',
        STORAGE_BUCKET: 'other',
      }),
    ).toEqual({ enabled: false });
  });

  it('is enabled for real AWS when all three are set and no endpoint is', () => {
    expect(readStorageConfig(FULL)).toEqual({
      enabled: true,
      region: 'ap-southeast-1',
      endpoint: undefined,
      bucket: DEFAULT_STORAGE_BUCKET,
      credentials: {
        accessKeyId: 'AKIDTEST',
        secretAccessKey: 'secret-value-that-must-never-be-printed',
      },
    });
  });

  it('carries a custom endpoint and bucket through', () => {
    expect(
      readStorageConfig({
        ...FULL,
        AWS_ENDPOINT_URL_S3: 'https://storage.example.com',
        STORAGE_BUCKET: 'photos',
      }),
    ).toMatchObject({
      enabled: true,
      endpoint: 'https://storage.example.com',
      bucket: 'photos',
    });
  });

  it('defaults the bucket to "assets", the one neon.ts declares', () => {
    expect(DEFAULT_STORAGE_BUCKET).toBe('assets');
    expect(readStorageConfig({ ...FULL, STORAGE_BUCKET: '' })).toMatchObject({
      bucket: 'assets',
    });
  });

  it('trims surrounding whitespace from values', () => {
    expect(
      readStorageConfig({ ...FULL, AWS_REGION: ' ap-southeast-1\n' }),
    ).toMatchObject({ region: 'ap-southeast-1' });
  });

  it.each([
    [
      'only the region',
      { AWS_REGION: 'ap-southeast-1' },
      ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    ],
    [
      'no secret key',
      { AWS_ACCESS_KEY_ID: 'AKIDTEST', AWS_REGION: 'ap-southeast-1' },
      ['AWS_SECRET_ACCESS_KEY'],
    ],
    [
      'no region',
      {
        AWS_ACCESS_KEY_ID: 'AKIDTEST',
        AWS_SECRET_ACCESS_KEY: FULL.AWS_SECRET_ACCESS_KEY,
      },
      ['AWS_REGION'],
    ],
  ])(
    'refuses half a configuration (%s), naming what is missing',
    (_label, env: Record<string, string>, missing) => {
      const attempt = () => readStorageConfig(env);

      expect(attempt).toThrow(StorageConfigError);
      expect(attempt).toThrow(`Missing: ${missing.join(', ')}.`);
    },
  );

  it('never puts a value in the error message, only names', () => {
    const attempt = () =>
      readStorageConfig({
        AWS_ACCESS_KEY_ID: 'AKIDTEST',
        AWS_SECRET_ACCESS_KEY: FULL.AWS_SECRET_ACCESS_KEY,
      });

    expect(attempt).toThrow(/AWS_REGION/);
    expect(attempt).not.toThrow(/AKIDTEST/);
    expect(attempt).not.toThrow(/secret-value/);
  });

  it.each(['storage.example.com', 'ftp://storage.example.com', 'not a url'])(
    'rejects an endpoint that is not an http(s) URL: %s',
    (endpoint) => {
      expect(() =>
        readStorageConfig({ ...FULL, AWS_ENDPOINT_URL_S3: endpoint }),
      ).toThrow(StorageConfigError);
    },
  );

  it('accepts a lookup function as well as a record', () => {
    const env: Record<string, string> = FULL;
    const lookup = jest.fn((name: string) => env[name]);

    expect(readStorageConfig(lookup)).toMatchObject({ enabled: true });
    expect(lookup).toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY');
  });
});
