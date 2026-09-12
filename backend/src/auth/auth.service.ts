import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { TokenService } from './token.service';

/** A password hash to verify against when the account does not exist, so a
 *  failed lookup costs the same time as a wrong password. */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c3R1ZGlvcmFnc2R1bW15c2FsdA$Yx3VLrn0zqPOe0VPQbGkXQ0bJ1J5gZ1HkKQ0Zq0Vv0A';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

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

  async issueSession(
    user: User,
    context: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedSession> {
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const { token: refreshToken } = await this.tokens.signRefreshToken(user.id);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokens.hash(refreshToken),
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs()),
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ip: context.ip ?? null,
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Rotate on every use. A refresh token is single-use: presenting one that has
   * already been spent means it leaked, so every session for that user is
   * revoked rather than just the one.
   */
  async rotateSession(
    presentedToken: string | undefined,
    context: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedSession> {
    if (!presentedToken) {
      throw new UnauthorizedException('Not signed in');
    }

    let payload: { sub: string };
    try {
      payload = await this.tokens.verifyRefreshToken(presentedToken);
    } catch {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    const tokenHash = this.tokens.hash(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    if (stored.revokedAt || stored.expiresAt < new Date()) {
      if (stored.revokedAt) {
        this.logger.warn(
          `Reused refresh token for user ${payload.sub}; revoking all sessions`,
        );
        await this.revokeAllSessions(payload.sub);
      }
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueSession(stored.user, context);
  }

  async revokeSession(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;

    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.tokens.hash(presentedToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
    // is logged in development so the flow is testable end to end.
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.log(`Password reset link for ${email}: ${url}`);
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.tokens.hash(token) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'That reset link is invalid or has expired',
      );
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Changing a password ends every other session.
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
