import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import express from 'express';
import request from 'supertest';
import { CSRF_PROBLEM_TYPE, CsrfTokenException } from '../csrf';
import { CsrfExceptionFilter } from './csrf-exception.filter';

/**
 * A real Express response, so the test sees the Content-Type and body that
 * Express actually writes rather than the calls a fake recorded.
 */
function refuse() {
  const app = express();
  app.post('/', (req, res) => {
    new CsrfExceptionFilter().catch(
      new CsrfTokenException(),
      new ExecutionContextHost([req, res, () => {}]),
    );
  });
  return request(app).post('/');
}

describe('CsrfExceptionFilter', () => {
  it('answers 403 as problem+json', async () => {
    const res = await refuse();

    expect(res.status).toBe(403);
    expect(res.get('Content-Type')).toMatch(/^application\/problem\+json\b/);
  });

  it('names the problem type the website looks for, and says what to do in words', async () => {
    const res = await refuse();

    expect(JSON.parse(res.text)).toEqual({
      type: CSRF_PROBLEM_TYPE,
      title: 'Security token missing or out of date',
      status: 403,
      detail:
        "This request did not carry this site's security token. Reload the page and try again.",
      statusCode: 403,
      message:
        "This request did not carry this site's security token. Reload the page and try again.",
    });
  });
});
