import type request from 'supertest';
import type { Test } from 'supertest';
import { CSRF_COOKIE, CSRF_HEADER } from '../../src/common/csrf';

type Client = ReturnType<typeof request>;

const WRITES = ['post', 'put', 'patch', 'delete', 'del'] as const;

/**
 * Makes a supertest client send what the website sends: every POST, PUT,
 * PATCH and DELETE carries the CSRF cookie and the same value in the
 * x-csrf-token header, as frontend/src/lib/session.ts does. The guard itself
 * is untouched; test/csrf.e2e-spec.ts uses the plain client to prove it
 * refuses requests without the pair.
 *
 * Both are added as the request is sent, so a test that sets its own Cookie
 * header (an access or refresh cookie) keeps it, with the CSRF cookie added
 * alongside. A test that sets its own CSRF cookie or header keeps that one.
 */
export function sendingCsrf(client: Client, token: string): Client {
  for (const method of WRITES) {
    const open = client[method].bind(client);
    client[method] = (url: string) => withToken(open(url), token);
  }
  return client;
}

function withToken(test: Test, token: string): Test {
  const send = test.end.bind(test);
  // then() and expect() both reach the server through end().
  test.end = (callback) => {
    const cookies = [test.get('Cookie') as string | string[] | undefined]
      .flat()
      .filter((part): part is string => Boolean(part));
    if (!cookies.some((part) => part.includes(`${CSRF_COOKIE}=`))) {
      test.set('Cookie', [...cookies, `${CSRF_COOKIE}=${token}`].join('; '));
    }
    if (test.get(CSRF_HEADER) === undefined) test.set(CSRF_HEADER, token);
    return send(callback);
  };
  return test;
}
