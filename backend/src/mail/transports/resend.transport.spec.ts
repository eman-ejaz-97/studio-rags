import { EMAIL_LOG_HEADER, type OutgoingEmail } from '../mail.transport';
import {
  RESEND_API_URL,
  RESEND_TIMEOUT_MS,
  ResendMailTransport,
} from './resend.transport';

const KEY = 're_test_key_that_must_never_be_printed';

const EMAIL: OutgoingEmail = {
  emailLogId: 'email_1',
  from: 'Studio Rags <onboarding@resend.dev>',
  to: 'developer@example.com',
  subject: 'Reset your Studio Rags password',
  html: '<p>Hello</p>',
  text: 'Hello',
};

/** A stand-in for fetch. Nothing in these tests reaches the network. */
function fakeFetch(respond: () => Promise<Response>) {
  return jest.fn<Promise<Response>, Parameters<typeof fetch>>(respond);
}

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('ResendMailTransport', () => {
  it('posts the email to Resend and returns its id', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }),
    );
    const transport = new ResendMailTransport(KEY, fetch);

    await expect(transport.send(EMAIL)).resolves.toEqual({
      messageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(RESEND_API_URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'studio-rags-api',
      'Idempotency-Key': 'email-log/email_1',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string)).toEqual({
      from: EMAIL.from,
      to: [EMAIL.to],
      subject: EMAIL.subject,
      html: EMAIL.html,
      text: EMAIL.text,
      headers: { [EMAIL_LOG_HEADER]: 'email_1' },
    });
  });

  it("explains a refusal in Resend's own words", async () => {
    // What Resend answers on the free plan for anyone but the account owner.
    const fetch = fakeFetch(() =>
      jsonResponse(403, {
        statusCode: 403,
        name: 'validation_error',
        message:
          'You can only send testing emails to your own email address (owner@example.com).',
      }),
    );
    const transport = new ResendMailTransport(KEY, fetch);

    await expect(transport.send(EMAIL)).rejects.toThrow(
      'Resend refused the email (HTTP 403 validation_error): You can only send testing emails to your own email address (owner@example.com).',
    );
  });

  it('copes with an error page that is not JSON', async () => {
    const fetch = fakeFetch(() =>
      Promise.resolve(
        new Response('<html>Bad gateway</html>', {
          status: 502,
          statusText: 'Bad Gateway',
        }),
      ),
    );
    const transport = new ResendMailTransport(KEY, fetch);

    await expect(transport.send(EMAIL)).rejects.toThrow(
      'Resend refused the email (HTTP 502): Bad Gateway',
    );
  });

  it('says so when Resend accepts but returns no id', async () => {
    const fetch = fakeFetch(() => jsonResponse(200, {}));
    const transport = new ResendMailTransport(KEY, fetch);

    await expect(transport.send(EMAIL)).rejects.toThrow(
      'Resend answered HTTP 200 but gave no email id',
    );
  });

  it('reports a network failure with its cause', async () => {
    const fetch = fakeFetch(() =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: new Error('getaddrinfo ENOTFOUND api.resend.com'),
        }),
      ),
    );
    const transport = new ResendMailTransport(KEY, fetch);

    await expect(transport.send(EMAIL)).rejects.toThrow(
      'Could not reach Resend: fetch failed: getaddrinfo ENOTFOUND api.resend.com',
    );
  });

  it('gives up after the timeout and says the email may have gone', async () => {
    const fetch = fakeFetch(() =>
      Promise.reject(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        ),
      ),
    );
    const transport = new ResendMailTransport(KEY, fetch);

    await expect(transport.send(EMAIL)).rejects.toThrow(
      `No answer from Resend within ${RESEND_TIMEOUT_MS / 1000} seconds; the email may or may not have been sent`,
    );
  });

  it('never puts the API key in an error', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(401, {
        name: 'missing_api_key',
        message: 'Missing API Key',
      }),
    );
    const transport = new ResendMailTransport(KEY, fetch);

    const error = await transport.send(EMAIL).catch((err: Error) => err);

    expect((error as Error).message).not.toContain(KEY);
  });
});
