import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { Request } from 'express';
import { CSRF_COOKIE, CSRF_HEADER, CsrfTokenException } from '../csrf';
import { CsrfExempt } from '../decorators/csrf-exempt.decorator';
import { CsrfGuard } from './csrf.guard';

// `this: void` marks these as handlers passed around by reference, the way
// Nest hands them to guards, which keeps the unbound-method lint satisfied.
class FormsController {
  submit(this: void) {}

  @CsrfExempt()
  webhook(this: void) {}
}

@CsrfExempt()
class WebhooksController {
  receive(this: void) {}
}

const TOKEN = 'x'.repeat(43);

interface Sent {
  method: string;
  cookie?: string;
  header?: string;
}

function contextFor(
  { method, cookie, header }: Sent,
  controller: new () => unknown = FormsController,
  handler: (this: void) => void = FormsController.prototype.submit,
): ExecutionContext {
  const req = {
    method,
    cookies: cookie === undefined ? {} : { [CSRF_COOKIE]: cookie },
    get: (name: string) => (name === CSRF_HEADER ? header : undefined),
  } as unknown as Request;
  return new ExecutionContextHost([req, {}], controller, handler);
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(new Reflector());

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets a %s through with no token, since it only reads',
    (method) => {
      expect(guard.canActivate(contextFor({ method }))).toBe(true);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'lets a %s through when the header repeats the cookie',
    (method) => {
      expect(
        guard.canActivate(contextFor({ method, cookie: TOKEN, header: TOKEN })),
      ).toBe(true);
    },
  );

  it.each([
    ['no cookie and no header', {}],
    ['a cookie but no header', { cookie: TOKEN }],
    ['a header but no cookie', { header: TOKEN }],
    ['a header that differs', { cookie: TOKEN, header: 'y'.repeat(43) }],
    ['a matching pair the API never issued', { cookie: 'abc', header: 'abc' }],
  ])('refuses a POST with %s', (_label, sent) => {
    const context = contextFor({ method: 'POST', ...sent });

    expect(() => guard.canActivate(context)).toThrow(CsrfTokenException);
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'PROPFIND'])(
    'refuses a %s with no token: every method that is not a read needs one',
    (method) => {
      expect(() => guard.canActivate(contextFor({ method }))).toThrow(
        CsrfTokenException,
      );
    },
  );

  it('lets a @CsrfExempt() handler through with no token', () => {
    const context = contextFor(
      { method: 'POST' },
      FormsController,
      FormsController.prototype.webhook,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('lets every handler of a @CsrfExempt() controller through', () => {
    const context = contextFor(
      { method: 'POST' },
      WebhooksController,
      WebhooksController.prototype.receive,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('stays out of anything that is not an HTTP request', () => {
    const context = contextFor({ method: 'POST' });
    jest.spyOn(context, 'getType').mockReturnValue('rpc');

    expect(guard.canActivate(context)).toBe(true);
  });
});
