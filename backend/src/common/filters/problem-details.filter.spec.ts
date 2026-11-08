import type { ArgumentsHost } from '@nestjs/common';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsFilter,
  ProblemException,
} from './problem-details.filter';

function responseStub() {
  const res = {
    status: jest.fn(),
    type: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.type.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function hostFor(res: ReturnType<typeof responseStub>): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
}

const problem = {
  type: '/problems/session-full',
  title: 'Not enough places left',
  status: 409,
  detail: 'Only 2 places are left in this class.',
  seatsLeft: 2,
};

describe('ProblemException', () => {
  it('carries the problem, plus the statusCode and message every API error has', () => {
    const error = new ProblemException(problem);

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      ...problem,
      statusCode: 409,
      message: 'Only 2 places are left in this class.',
    });
  });
});

describe('ProblemDetailsFilter', () => {
  it('sends the body as application/problem+json with the problem status', () => {
    const res = responseStub();

    new ProblemDetailsFilter().catch(
      new ProblemException(problem),
      hostFor(res),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.type).toHaveBeenCalledWith(PROBLEM_CONTENT_TYPE);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ...problem, statusCode: 409 }),
    );
  });
});
