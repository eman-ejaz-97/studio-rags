import {
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  clientAddress,
} from './client-address';

const SECRET = 'unit-test-only-proxy-secret-0123456789';
const SOCKET = '10.0.0.5';

/** Just enough of an Express request: its ip and a header lookup. */
function fakeRequest(
  headers: Record<string, string>,
  ip: string | undefined = SOCKET,
) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ip,
    get: (name: string) => lower[name.toLowerCase()],
  } as Parameters<typeof clientAddress>[0];
}

const signed = (ip: string, secret = SECRET) =>
  fakeRequest({ [CLIENT_IP_HEADER]: ip, [PROXY_SECRET_HEADER]: secret });

describe('clientAddress', () => {
  it('uses req.ip when no secret is configured, whatever the headers say', () => {
    expect(clientAddress(signed('203.0.113.10'), undefined)).toBe(SOCKET);
    expect(clientAddress(signed('203.0.113.10'), '')).toBe(SOCKET);
  });

  it('uses req.ip when the request carries no secret', () => {
    const req = fakeRequest({ [CLIENT_IP_HEADER]: '203.0.113.10' });

    expect(clientAddress(req, SECRET)).toBe(SOCKET);
  });

  it('uses req.ip when the secret is wrong but the same length', () => {
    const wrong = SECRET.replace(/.$/, 'X');
    expect(wrong).toHaveLength(SECRET.length);

    expect(clientAddress(signed('203.0.113.10', wrong), SECRET)).toBe(SOCKET);
  });

  it.each([
    ['shorter', SECRET.slice(0, -1)],
    ['longer', `${SECRET}0`],
    ['empty', ''],
  ])('uses req.ip when the secret is %s, without throwing', (_, presented) => {
    expect(clientAddress(signed('203.0.113.10', presented), SECRET)).toBe(
      SOCKET,
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not an address', 'nobody'],
    ['a list, as a header sent twice arrives', '198.51.100.7, 203.0.113.10'],
    ['an address with a port', '203.0.113.10:443'],
  ])('uses req.ip when the client address is %s', (_, claimed) => {
    const req = fakeRequest({
      [PROXY_SECRET_HEADER]: SECRET,
      ...(claimed === undefined ? {} : { [CLIENT_IP_HEADER]: claimed }),
    });

    expect(clientAddress(req, SECRET)).toBe(SOCKET);
  });

  it.each([
    ['IPv4', '203.0.113.10', '203.0.113.10'],
    ['IPv6', '2001:db8::7', '2001:db8::7'],
    ['padded', '  203.0.113.10 ', '203.0.113.10'],
  ])('believes a signed %s client address', (_, claimed, expected) => {
    expect(clientAddress(signed(claimed), SECRET)).toBe(expected);
  });

  it('passes an undefined req.ip through when it falls back', () => {
    const gone = { ip: undefined, get: () => undefined };

    expect(clientAddress(gone, SECRET)).toBeUndefined();
  });
});
