/**
 * Decides how the seed may create the admin account, before it connects.
 *
 * The repository is public, so DEV_DEFAULT_ADMIN_PASSWORD is public too. It is
 * only acceptable on a database nobody else can reach. Anywhere else the seed
 * must be handed a real password, or it refuses to run.
 *
 * Pure on purpose: it reads the environment it is given and returns a
 * decision, so every branch is unit-tested without a database.
 */

export const DEV_DEFAULT_ADMIN_PASSWORD = 'ChangeMe-Studio2026';

export const MIN_SEED_ADMIN_PASSWORD_LENGTH = 12;

/** Hosts that only this machine can reach. URL keeps IPv6 in brackets. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type SeedAdminPlan =
  | {
      ok: true;
      password: string;
      /** True when falling back to the public development password. */
      usingDefaultPassword: boolean;
      /** Replace an existing admin's password hash (SEED_ADMIN_ROTATE=1). */
      rotatePassword: boolean;
    }
  | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

/**
 * True only when DATABASE_URL clearly names this machine. Anything that does
 * not parse, or carries a ?host= that libpq and Prisma would connect to
 * instead of the URL's own host, counts as remote.
 */
export function isLocalDatabaseUrl(raw: string | undefined): boolean {
  if (!raw) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.searchParams.has('host')) return false;
  return LOCAL_HOSTS.has(url.hostname.toLowerCase());
}

export function planSeedAdmin(env: Env): SeedAdminPlan {
  const rotateFlag = env.SEED_ADMIN_ROTATE ?? '';
  if (rotateFlag !== '' && rotateFlag !== '0' && rotateFlag !== '1') {
    // A silent no-op here would leave a leaked password in place while the
    // operator believed it had been replaced.
    return {
      ok: false,
      reason:
        'SEED_ADMIN_ROTATE must be 1 (replace the admin password) or unset.',
    };
  }
  const rotatePassword = rotateFlag === '1';

  const given = env.SEED_ADMIN_PASSWORD;
  if (given) {
    if (given.length < MIN_SEED_ADMIN_PASSWORD_LENGTH) {
      return {
        ok: false,
        reason: `SEED_ADMIN_PASSWORD must be at least ${MIN_SEED_ADMIN_PASSWORD_LENGTH} characters.`,
      };
    }
    return {
      ok: true,
      password: given,
      usingDefaultPassword: false,
      rotatePassword,
    };
  }

  if (env.NODE_ENV === 'production') {
    return {
      ok: false,
      reason:
        'SEED_ADMIN_PASSWORD is not set and NODE_ENV is production. The default development password is published in the repository. Set SEED_ADMIN_PASSWORD (at least 12 characters) and run the seed again.',
    };
  }

  if (!isLocalDatabaseUrl(env.DATABASE_URL)) {
    return {
      ok: false,
      reason:
        'SEED_ADMIN_PASSWORD is not set and DATABASE_URL does not point at localhost. The default development password is published in the repository, so it may only be seeded into a local database. Set SEED_ADMIN_PASSWORD (at least 12 characters) and run the seed again.',
    };
  }

  return {
    ok: true,
    password: DEV_DEFAULT_ADMIN_PASSWORD,
    usingDefaultPassword: true,
    rotatePassword,
  };
}

export type ExistingAccountAction =
  | { action: 'keep' }
  | { action: 'rotate' }
  | { action: 'refuse'; reason: string };

/**
 * What to do when an account already has the admin email. Registration is
 * open and the admin address is in this repository, so a non-admin account
 * there may belong to whoever signed up with it first. Promoting it as it
 * stands would hand them the admin role with a password they chose.
 */
export function planExistingAccount(
  isAdmin: boolean,
  rotatePassword: boolean,
): ExistingAccountAction {
  if (rotatePassword) return { action: 'rotate' };
  if (isAdmin) return { action: 'keep' };
  return {
    action: 'refuse',
    reason:
      'An account with the admin email already exists but is not an admin, so someone may have registered it. Promoting it would give them the admin role with their own password. Re-run with SEED_ADMIN_ROTATE=1 to replace its password with the seed password and sign out its sessions.',
  };
}
