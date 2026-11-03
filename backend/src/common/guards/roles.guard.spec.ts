import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

// `this: void` marks these as handlers passed around by reference, the way
// Nest hands them to guards, which keeps the unbound-method lint satisfied.
class OpenController {
  anyone(this: void) {}

  @Roles()
  emptyList(this: void) {}

  @Roles(Role.ADMIN)
  adminOnly(this: void) {}

  @Roles(Role.CUSTOMER, Role.ADMIN)
  signedIn(this: void) {}
}

@Roles(Role.ADMIN)
class AdminController {
  inherited(this: void) {}
}

function contextFor(
  controller: new () => unknown,
  handler: (this: void) => void,
  user?: AuthenticatedUser,
): ExecutionContext {
  return new ExecutionContextHost([{ user }, {}], controller, handler);
}

const customer: AuthenticatedUser = {
  id: 'user_1',
  email: 'jane@example.com',
  role: Role.CUSTOMER,
};
const admin: AuthenticatedUser = {
  id: 'user_2',
  email: 'owner@example.com',
  role: Role.ADMIN,
};

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a handler with no @Roles(), even with no user on the request', () => {
    expect(
      guard.canActivate(
        contextFor(OpenController, OpenController.prototype.anyone),
      ),
    ).toBe(true);
  });

  it('treats an empty @Roles() as no restriction', () => {
    expect(
      guard.canActivate(
        contextFor(OpenController, OpenController.prototype.emptyList),
      ),
    ).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    expect(
      guard.canActivate(
        contextFor(OpenController, OpenController.prototype.adminOnly, admin),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor(OpenController, OpenController.prototype.signedIn, customer),
      ),
    ).toBe(true);
  });

  it('forbids a user whose role is not listed', () => {
    const context = contextFor(
      OpenController,
      OpenController.prototype.adminOnly,
      customer,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(
      'You do not have access to this resource',
    );
  });

  it('forbids rather than crashes when no user is on the request', () => {
    const context = contextFor(
      OpenController,
      OpenController.prototype.adminOnly,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('applies a controller-level @Roles() to handlers without their own', () => {
    expect(() =>
      guard.canActivate(
        contextFor(
          AdminController,
          AdminController.prototype.inherited,
          customer,
        ),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        contextFor(AdminController, AdminController.prototype.inherited, admin),
      ),
    ).toBe(true);
  });
});
