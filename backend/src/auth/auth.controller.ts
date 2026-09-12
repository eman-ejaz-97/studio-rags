import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import type { IssuedSession } from './auth.service';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from './auth.cookies';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.register(dto);
    const session = await this.auth.issueSession(user, this.contextOf(req));
    this.applySession(res, session);
    return { user: this.auth.toPublicUser(user) };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.validateCredentials(dto.email, dto.password);
    const session = await this.auth.issueSession(user, this.contextOf(req));
    this.applySession(res, session);
    return { user: this.auth.toPublicUser(user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    try {
      const session = await this.auth.rotateSession(
        presented,
        this.contextOf(req),
      );
      this.applySession(res, session);
      return { ok: true };
    } catch (error) {
      clearAuthCookies(res, this.isProduction);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeSession(
      req.cookies?.[REFRESH_COOKIE] as string | undefined,
    );
    clearAuthCookies(res, this.isProduction);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    // Deliberately identical whether or not the account exists.
    return {
      message:
        'If that email address has an account, a reset link is on its way.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.resetPassword(dto.token, dto.password);
    clearAuthCookies(res, this.isProduction);
    return { message: 'Your password has been changed. Please sign in.' };
  }

  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.auth.findById(current.id);
    if (!user) throw new NotFoundException('Account not found');
    return { user: this.auth.toPublicUser(user) };
  }

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private applySession(res: Response, session: IssuedSession) {
    setAccessCookie(
      res,
      session.accessToken,
      this.tokens.accessTtlMs(),
      this.isProduction,
    );
    setRefreshCookie(
      res,
      session.refreshToken,
      this.tokens.refreshTtlMs(),
      this.isProduction,
    );
  }

  private contextOf(req: Request) {
    return { userAgent: req.get('user-agent') ?? undefined, ip: req.ip };
  }
}
