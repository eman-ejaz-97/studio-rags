import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AuthGuard, IAuthGuard } from '@nestjs/passport';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

// `this: void` marks these as handlers passed around by reference, the way
// Nest hands them to guards, which keeps the unbound-method lint satisfied.
@Public()
class PublicController {
  list(this: void) {}
}

class MixedController {
  @Public()
  open(this: void) {}

  closed(this: void) {}
}

function contextFor(
  controller: new () => unknown,
  handler: (this: void) => void,
): ExecutionContext {
  return new ExecutionContextHost([{ headers: {} }, {}], controller, handler);
}

describe('JwtAuthGuard', () => {
  // The passport half of the guard. Stubbed so these tests are about the
  // @Public() decision alone; jwt.strategy.spec covers the token checks.
  let passportCanActivate: jest.SpyInstance;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    passportCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype as IAuthGuard, 'canActivate')
      .mockImplementation(() => Promise.resolve(true));
    guard = new JwtAuthGuard(new Reflector());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates to the "jwt" passport strategy, the name JwtStrategy registers', () => {
    expect(Object.getPrototypeOf(JwtAuthGuard)).toBe(AuthGuard('jwt'));
  });

  it('lets a @Public() handler through without asking passport', () => {
    const context = contextFor(MixedController, MixedController.prototype.open);

    expect(guard.canActivate(context)).toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('lets every handler of a @Public() controller through without asking passport', () => {
    const context = contextFor(
      PublicController,
      PublicController.prototype.list,
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('hands an undecorated handler to passport', async () => {
    const context = contextFor(
      MixedController,
      MixedController.prototype.closed,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(passportCanActivate).toHaveBeenCalledTimes(1);
    expect(passportCanActivate).toHaveBeenCalledWith(context);
  });

  it("passes passport's rejection straight back, so protected is the default", async () => {
    passportCanActivate.mockImplementation(() =>
      Promise.reject(new UnauthorizedException()),
    );
    const context = contextFor(
      MixedController,
      MixedController.prototype.closed,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
