import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { clientAddress } from '../client-address';

/**
 * The stock ThrottlerGuard, counting per visitor as clientAddress() finds
 * them rather than per req.ip, so visitors coming through the website are
 * told apart even though they all arrive from Vercel's servers.
 */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected getTracker(req: Request): Promise<string> {
    const secret = this.config.get<string>('API_PROXY_SECRET');
    // req.ip is undefined only once the socket has gone; the stock guard
    // would key that on "undefined", so this matches it.
    return Promise.resolve(clientAddress(req, secret) ?? 'undefined');
  }
}
