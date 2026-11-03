import { HttpStatus, Logger } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function fakeResponse() {
  const res = {
    status: jest.fn<unknown, [number]>(),
    json: jest.fn<unknown, [unknown]>(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function prismaError(code: string, message = `Prisma failure ${code}`) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'test',
    meta: { target: ['email'], modelName: 'User' },
  });
}

describe('PrismaExceptionFilter', () => {
  const filter = new PrismaExceptionFilter();

  function respond(code: string, message?: string) {
    const res = fakeResponse();
    filter.catch(
      prismaError(code, message),
      new ExecutionContextHost([{}, res, () => {}]),
    );
    return res;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers a unique-key clash (P2002) with 409', () => {
    const res = respond('P2002');

    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 409,
      message: 'That value is already in use',
    });
  });

  it('answers a missing record (P2025) with 404', () => {
    const res = respond('P2025');

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'Not found',
    });
  });

  it('answers anything else with a generic 500 and logs the detail server-side', () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    const res = respond(
      'P2003',
      'Foreign key constraint failed on the field: `bookings_userId_fkey`',
    );

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Something went wrong',
    });
    expect(error).toHaveBeenCalledWith(
      'Unhandled Prisma error P2003',
      expect.any(String),
    );
  });
});
