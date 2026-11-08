import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * An RFC 9457 problem. `type` names the kind of refusal, so a client can act
 * on it without parsing words; `title` is fixed per type; `detail` is written
 * for the customer. Extension members carry the facts a client needs to act,
 * such as how many places are left.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  [extension: string]: unknown;
}

/**
 * A refusal the client is expected to handle by its type, not only display.
 *
 * The body also carries `statusCode` and `message`, which every other error
 * from this API has, so a client that only reads those (the frontend's
 * session.ts reads `message`) shows the detail without knowing about problems.
 */
export class ProblemException extends HttpException {
  constructor(readonly problem: ProblemDetails) {
    super(
      { ...problem, statusCode: problem.status, message: problem.detail },
      problem.status,
    );
  }
}

/**
 * Sends a ProblemException as application/problem+json. Applied per
 * controller with @UseFilters, so routes that never throw one are untouched.
 */
@Catch(ProblemException)
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: ProblemException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .type(PROBLEM_CONTENT_TYPE)
      .json(exception.getResponse());
  }
}
