// Loaded here rather than left to whoever imports this file: @Type() below
// reads Reflect metadata while the class is being defined, so a script or test
// importing this file on its own would crash before validateEnv could run.
import 'reflect-metadata';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Min,
  MinLength,
  ValidateBy,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** The shape TokenService parses: a whole number, then s, m, h or d. */
const DURATION = /^\s*\d+\s*[smhd]\s*$/;

const durationMessage = (key: string) =>
  `${key} must be a whole number followed by s, m, h or d (seconds, minutes, hours, days), e.g. 15m or 30d`;

const TRUST_PROXY_MESSAGE =
  'TRUST_PROXY must be a whole number of proxy hops in front of the API: 0 (the default) trusts none, 1 trusts one such as a hosting load balancer';

const API_PROXY_SECRET_MESSAGE =
  'API_PROXY_SECRET must be at least 32 characters when set; generate one with `openssl rand -hex 32` and give the frontend the same value';

/**
 * Why a CORS origin is unusable, or null when it is fine. The browser sends
 * its Origin header as scheme://host[:port], lower-case, with no path and no
 * default port, and the cors package compares that string exactly. A trailing
 * slash or a path pasted from the address bar would never match, and every
 * credentialed request would fail with an error that never names this setting.
 */
export function bareOriginProblem(value: unknown): string | null {
  if (typeof value !== 'string') {
    return 'must be a string';
  }

  if (!/^https?:\/\//i.test(value)) {
    return 'must start with http:// or https://, e.g. https://studio-rags.vercel.app';
  }

  if (/[\s,]/.test(value)) {
    return 'must be exactly one origin, with no spaces or commas';
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be a valid origin, e.g. https://studio-rags.vercel.app';
  }

  if (url.origin !== value) {
    return `must be a bare origin (lower-case scheme and host, no path, query, trailing slash or default port): use "${url.origin}"`;
  }

  return null;
}

function IsBareOrigin(): PropertyDecorator {
  return ValidateBy({
    name: 'isBareOrigin',
    validator: {
      validate: (value: unknown) => bareOriginProblem(value) === null,
      defaultMessage: (args) =>
        `${args?.property} ${bareOriginProblem(args?.value)}`,
    },
  });
}

/**
 * Fail fast on a bad environment. A missing JWT secret should stop the process
 * at boot, not surface as a confusing 500 once someone tries to log in.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  // Env values arrive as strings; coerce explicitly rather than relying on
  // implicit conversion, which depends on emitted decorator metadata.
  @Type(() => Number)
  @IsInt()
  PORT = 3001;

  /**
   * The address to listen on. All interfaces by default, because inside a
   * container (and on Render) traffic arrives from outside it; a server bound
   * to localhost there is unreachable.
   */
  @IsString()
  @IsNotEmpty()
  HOST = '0.0.0.0';

  /**
   * How many reverse proxies to believe about the client's address. Express
   * then takes req.ip from that many hops into X-Forwarded-For, and the rate
   * limiter counts per req.ip. 0 ignores the header entirely, which is right
   * when nothing sits in front: a client could otherwise rotate the header
   * and get a fresh login allowance every time.
   */
  @Type(() => Number)
  @IsInt({ message: TRUST_PROXY_MESSAGE })
  @Min(0, { message: TRUST_PROXY_MESSAGE })
  TRUST_PROXY = 0;

  /**
   * Shared with the frontend, whose proxy sends it with the visitor's address
   * (common/client-address.ts). Unset, the API never believes that address and
   * counts every request by req.ip. Empty counts as unset, so a blank line in
   * an env file switches it off rather than failing the length check.
   */
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(32, { message: API_PROXY_SECRET_MESSAGE })
  API_PROXY_SECRET?: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters',
  })
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32, {
    message: 'JWT_REFRESH_SECRET must be at least 32 characters',
  })
  JWT_REFRESH_SECRET: string;

  @IsString()
  @Matches(DURATION, { message: durationMessage('JWT_ACCESS_TTL') })
  JWT_ACCESS_TTL = '15m';

  @IsString()
  @Matches(DURATION, { message: durationMessage('JWT_REFRESH_TTL') })
  JWT_REFRESH_TTL = '30d';

  @IsBareOrigin()
  CORS_ORIGIN = 'http://localhost:3000';

  @IsUrl({ require_tld: false })
  APP_URL = 'http://localhost:3000';

  @IsOptional()
  @IsString()
  MAIL_FROM?: string;
}

/**
 * Rules that span more than one variable, which class-validator's
 * per-property decorators cannot express. Each entry reads like a validator
 * message, so the report below stays uniform.
 */
function crossFieldProblems(config: EnvironmentVariables): string[] {
  const problems: string[] = [];

  // One shared key would let a 30-day refresh token verify as an access
  // token. The values are never echoed: they are the secrets.
  if (
    typeof config.JWT_ACCESS_SECRET === 'string' &&
    config.JWT_ACCESS_SECRET.length > 0 &&
    config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET
  ) {
    problems.push(
      '  - JWT_REFRESH_SECRET: JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET; generate a separate random value for each',
    );
  }

  return problems;
}

export function validateEnv(raw: Record<string, unknown>) {
  const config = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(config, { skipMissingProperties: false });

  const problems = [
    ...errors.map(
      (e) =>
        `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    ),
    ...crossFieldProblems(config),
  ];

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${problems.join('\n')}`,
    );
  }

  return config;
}
