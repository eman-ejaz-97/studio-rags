import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { CSRF_PROBLEM_TYPE, CSRF_REFUSED, CsrfTokenException } from '../csrf';

/**
 * Answers a CSRF refusal as RFC 9457 problem+json, the error format SPEC § 6
 * names. The website looks for the type before it fetches a fresh token and
 * tries again. statusCode and message repeat the shape of the API's other
 * errors, so code that reads those keeps working.
 *
 * A filter, because Nest's own error handling would reset the Content-Type
 * to application/json.
 */
@Catch(CsrfTokenException)
export class CsrfExceptionFilter implements ExceptionFilter {
  catch(_exception: CsrfTokenException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.FORBIDDEN).type('application/problem+json').json({
      type: CSRF_PROBLEM_TYPE,
      title: 'Security token missing or out of date',
      status: HttpStatus.FORBIDDEN,
      detail: CSRF_REFUSED,
      statusCode: HttpStatus.FORBIDDEN,
      message: CSRF_REFUSED,
    });
  }
}
