import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from './current-user.decorator';

type ParamFactory = (data: unknown, context: ExecutionContext) => unknown;

/**
 * Resolves @CurrentUser(field) against a request the way Nest does. Nest keeps
 * a param decorator's factory in route metadata rather than exposing it, so
 * decorate a throwaway handler and read the factory back.
 */
function resolve(field: keyof AuthenticatedUser | undefined, request: object) {
  class Probe {
    handler(@CurrentUser(field) user: unknown) {
      return user;
    }
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'handler',
  ) as Record<string, { factory: ParamFactory; data: unknown }>;
  const [entry] = Object.values(args);
  return entry.factory(
    entry.data,
    new ExecutionContextHost([request, {}, () => {}]),
  );
}

const user: AuthenticatedUser = {
  id: 'user_1',
  email: 'jane@example.com',
  role: Role.CUSTOMER,
};

describe('@CurrentUser()', () => {
  it('hands the controller the user that JwtStrategy put on the request', () => {
    expect(resolve(undefined, { user })).toBe(user);
  });

  it.each(['id', 'email', 'role'] as const)(
    'hands over just the %s when asked for one field',
    (field) => {
      expect(resolve(field, { user })).toBe(user[field]);
    },
  );

  it('returns undefined rather than throwing on a request with no user', () => {
    expect(resolve(undefined, {})).toBeUndefined();
    expect(resolve('id', {})).toBeUndefined();
  });
});
