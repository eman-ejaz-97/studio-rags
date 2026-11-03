import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RefreshTokenRevocation, Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { TokenService } from './token.service';

/** A password hash to verify against when the account does not exist, so a
 *  failed lookup costs the same time as a wrong password. */
export const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c3R1ZGlvcmFnc2R1bW15c2FsdA$Yx3VLrn0zqPOe0VPQbGkXQ0bJ1J5gZ1HkKQ0Zq0Vv0A';

/**
 * How long after a refresh token is spent that presenting it again counts as
 * a harmless double-submit rather than theft. Two browser tabs refreshing at
 * once both send the same cookie; the slower one arrives a few milliseconds
 * after the faster one spent it. Inside the window the request gets a 401 and
 * nothing is revoked. After it, the token's session ends, and if its successor
 * was used meanwhile, the reuse is treated as theft and every session for the
 * user ends. The window never issues a session.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/**
 * NODE_ENV values in which the raw reset link may be written to the log. An
 * allow-list, so a value nobody planned for (a "staging" typo, say) keeps the
 * link out of the log rather than in it.
 */
const RESET_LINK_LOGGED_IN: ReadonlySet<string> = new Set([
  'development',
  'test',
]);

const SESSION_EXPIRED = 'Session expired, please sign in again';
const INVALID_CREDENTIALS = 'Email or password is incorrect';
const INVALID_RESET_LINK = 'That reset link is invalid or has expired';

/**
 * The 401 for a refresh that lost to another request carrying the same token,
 * either at the same moment or within the grace window: the two-tab case.
 * Same status and body as any other refresh 401, but the controller leaves the
 * cookies alone. Tabs share one cookie jar, and the winner's new cookies may
 * already be in it; clearing them here would sign the user out even though
 * the winner's session is perfectly valid.
 *
 * The other request this answers is a retry whose first attempt won but whose
 * response never arrived. That browser keeps the spent token, and sends it
 * again at its next refresh, after the window. Nobody ever used the successor
 * it lost, so that refresh ends this one session and nothing else (see
 * rotateLocked); it does not sign the user out of their other devices.
 */
export class RefreshRaceLostException extends UnauthorizedException {
  constructor() {
    super(SESSION_EXPIRED);
  }
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

/**
 * How a token can end that proves its holder received it: by refreshing with
 * it, or by signing out with it. A token ended any other way (a password
 * reset, a reuse response) may never have reached anyone.
 */
const PRESENTED_BY_HOLDER: ReadonlySet<RefreshTokenRevocation> = new Set([
  RefreshTokenRevocation.ROTATED,
  RefreshTokenRevocation.SIGNED_OUT,
]);

/** What a refresh decided, worked out inside the transaction. */
type RotationOutcome =
  | { kind: 'rotated'; session: IssuedSession }
  | { kind: 'lost-race' }
  | { kind: 'reuse-detected' }
  | { kind: 'successor-unused' }
  | { kind: 'dead' };

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: Role;
  marketingConsent: boolean;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      marketingConsent: user.marketingConsentAt !== null,
      createdAt: user.createdAt,
    };
  }

  async register(dto: RegisterDto): Promise<User> {
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone ?? null,
          marketingConsentAt: dto.marketingConsent ? new Date() : null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with that email already exists',
        );
      }
      throw error;
    }
  }

  async validateCredentials(email: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always verify something, so the response time does not reveal whether
    // the address is registered.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    let ok = false;
    try {
      ok = await argon2.verify(hash, password);
    } catch {
      ok = false;
    }

    if (!user || !ok) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    return user;
  }

  /**
   * Opens a session for a user whose password was just checked (sign-in) or
   * set (registration).
   *
   * The row is written under the user's lock, after reading the password hash
   * again. A password reset takes the same lock, so the two cannot interleave:
   * either the reset committed first, the hash no longer matches the one that
   * was verified, and this sign-in is refused; or this session is written
   * first, and the reset then revokes it along with the others.
   */
  async issueSession(
    user: User,
    context: SessionContext = {},
  ): Promise<IssuedSession> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndReadUser(tx, user.id);
      if (!current || current.passwordHash !== user.passwordHash) {
        throw new UnauthorizedException(INVALID_CREDENTIALS);
      }
      return this.createSession(tx, current, context);
    });
  }

  /**
   * Rotate on every use. A refresh token is single-use. Presenting one that was
   * rotated more than REFRESH_REUSE_GRACE_MS ago ends its session; if somebody
   * had already used the successor, two parties held it, so every session for
   * that user is revoked rather than just the one.
   *
   * Everything after the first read runs in one transaction under the user's
   * lock: spending the old token, writing its successor, or deciding the reuse
   * was theft and revoking everything. A password reset or a theft response
   * queues behind the same lock, so it always sees the successor and revokes
   * it too; before, a refresh already in flight could write a fresh 30-day
   * session just after a reset had revoked "every" session.
   */
  async rotateSession(
    presentedToken: string | undefined,
    context: SessionContext = {},
  ): Promise<IssuedSession> {
    if (!presentedToken) {
      throw new UnauthorizedException('Not signed in');
    }

    try {
      await this.tokens.verifyRefreshToken(presentedToken);
    } catch {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }

    // Only to learn whose lock to take. Every decision is made again inside
    // the transaction, against the row as it is once the lock is held.
    const found = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hash(presentedToken) },
      select: { id: true, userId: true },
    });

    if (!found) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }

    // Returned rather than thrown from inside, because a throw would roll
    // back the theft response along with everything else.
    const outcome = await this.prisma.$transaction((tx) =>
      this.rotateLocked(tx, found.id, found.userId, context),
    );

    switch (outcome.kind) {
      case 'rotated':
        return outcome.session;
      case 'lost-race':
        throw new RefreshRaceLostException();
      case 'reuse-detected':
        this.logger.warn(
          `Reused refresh token for user ${found.userId}; revoked all sessions`,
        );
        throw new UnauthorizedException(SESSION_EXPIRED);
      case 'successor-unused':
        this.logger.warn(
          `Rotated refresh token for user ${found.userId} came back with its successor unused; ended that session only`,
        );
        throw new UnauthorizedException(SESSION_EXPIRED);
      case 'dead':
        throw new UnauthorizedException(SESSION_EXPIRED);
    }
  }

  private async rotateLocked(
    tx: Prisma.TransactionClient,
    tokenId: string,
    userId: string,
    context: SessionContext,
  ): Promise<RotationOutcome> {
    const user = await this.lockAndReadUser(tx, userId);
    if (!user) return { kind: 'dead' };

    const now = new Date();

    // The claim. The WHERE checks liveness at the moment of writing, so of
    // two requests carrying one token exactly one can spend it; reading the
    // row and checking revokedAt in JavaScript first would let both through.
    const claim = await tx.refreshToken.updateMany({
      where: { id: tokenId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokedReason: RefreshTokenRevocation.ROTATED },
    });

    if (claim.count === 1) {
      return {
        kind: 'rotated',
        session: await this.createSession(tx, user, context, tokenId),
      };
    }

    // Not live. With the lock held, no other session write for this user is
    // part-way through, so this is the settled state of the row, and of the
    // successor a refresh wrote when it spent it.
    const row = await tx.refreshToken.findUnique({
      where: { id: tokenId },
      select: {
        revokedAt: true,
        revokedReason: true,
        rotatedTo: { select: { id: true, revokedReason: true } },
      },
    });

    // Only a rotated token coming back can say two parties held it. Expired,
    // signed out, reset, already answered as theft, or revoked before reasons
    // were recorded: a stale tab, and simply a dead token.
    if (
      !row?.revokedAt ||
      row.revokedReason !== RefreshTokenRevocation.ROTATED
    ) {
      return { kind: 'dead' };
    }

    // Within the window: the other tab, or a retried request. It earns a 401
    // and never a session; the winner already holds the successor.
    if (now.getTime() - row.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
      return { kind: 'lost-race' };
    }

    // Late. Nobody has used the successor: this is what a browser sends when
    // the response carrying the successor never reached it (a dropped
    // connection, a cold start that timed out), at its next refresh. It is
    // also what a stolen copy looks like before the owner refreshes again,
    // and the two cannot be told apart. Either way, end this one session: the
    // successor goes, and this request is refused, so neither party keeps it.
    // The user's other sessions were never exposed by this cookie, and stay.
    const successor = row.rotatedTo;
    const successorUsed =
      successor?.revokedReason != null &&
      PRESENTED_BY_HOLDER.has(successor.revokedReason);
    if (successor && !successorUsed) {
      await tx.refreshToken.updateMany({
        where: { id: successor.id, revokedAt: null },
        data: {
          revokedAt: now,
          revokedReason: RefreshTokenRevocation.REUSE_DETECTED,
        },
      });
      return { kind: 'successor-unused' };
    }

    // Somebody used the successor, and somebody else still holds this token:
    // two parties held the session, so treat it as theft and end every
    // session for the user. A token rotated before successors were recorded
    // cannot show which, and gets the same answer.
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: {
        revokedAt: now,
        revokedReason: RefreshTokenRevocation.REUSE_DETECTED,
      },
    });
    // Answered once. Replaying the same token later is a dead token, so it
    // cannot end the sessions the owner opens after this.
    await tx.refreshToken.updateMany({
      where: { id: tokenId },
      data: { revokedReason: RefreshTokenRevocation.REUSE_DETECTED },
    });
    return { kind: 'reuse-detected' };
  }

  async revokeSession(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;

    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.tokens.hash(presentedToken), revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: RefreshTokenRevocation.SIGNED_OUT,
      },
    });
  }

  /**
   * Locks the user's row until the transaction ends. Every path that writes a
   * session or revokes them all takes this lock first, so for any one user
   * they run one after another rather than interleaving. Other users are
   * never blocked.
   */
  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE
    `;
    return rows.length === 1;
  }

  /** Takes the user's lock, then reads the row as it is under that lock. */
  private async lockAndReadUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<User | null> {
    if (!(await this.lockUser(tx, userId))) return null;
    return tx.user.findUnique({ where: { id: userId } });
  }

  /**
   * Signs both tokens and stores the refresh token's hash. A refresh passes
   * the token it spent, which links the two for reuse detection.
   */
  private async createSession(
    tx: Prisma.TransactionClient,
    user: User,
    context: SessionContext,
    rotatedFromId: string | null = null,
  ): Promise<IssuedSession> {
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const { token: refreshToken } = await this.tokens.signRefreshToken(user.id);

    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokens.hash(refreshToken),
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs()),
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ip: context.ip ?? null,
        rotatedFromId,
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Always succeeds from the caller's point of view. Telling an anonymous
   * visitor whether an address is registered is an account-enumeration hole.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const token = this.tokens.randomToken();

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokens.hash(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // one hour
      },
    });

    const url = `${this.config.getOrThrow<string>('APP_URL')}/reset-password?token=${token}`;

    // TODO(phase-3): send through the mail module. Until that exists, the link
    // is logged in development so the flow is testable end to end. The link is
    // a live credential for the account, so only named environments log it.
    if (RESET_LINK_LOGGED_IN.has(this.config.get<string>('NODE_ENV') ?? '')) {
      this.logger.log(`Password reset link for ${email}: ${url}`);
    }
  }

  /**
   * Single-use under concurrency: the token is spent by a conditional UPDATE
   * inside the same transaction as the password change, so two requests with
   * one token cannot both get through. The transaction holds the user's lock,
   * so a refresh or sign-in that is part-way through writing a session
   * finishes first, and the revoke below sees its row.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.tokens.hash(token) },
    });

    // Not the safety check (the claim below is), but it spares the argon2
    // work for links that were never valid or are plainly spent.
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException(INVALID_RESET_LINK);
    }

    // Hashed before the transaction opens, so the transaction holds its
    // connection and row lock for a few milliseconds, not the whole hash.
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, record.userId);

      const now = new Date();
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });

      if (claim.count !== 1) {
        // Spent by a concurrent request since the read above. Throwing
        // rolls the transaction back, so nothing below is written.
        throw new UnauthorizedException(INVALID_RESET_LINK);
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });

      // Changing a password ends every other session.
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: {
          revokedAt: now,
          revokedReason: RefreshTokenRevocation.PASSWORD_RESET,
        },
      });

      // And voids every other reset link the user asked for. An older unused
      // one would otherwise change the password again for up to an hour,
      // locking the owner out of the password they just chose.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
