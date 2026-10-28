import {
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('approval failure response contract', () => {
  function responseFor(body: string | Record<string, unknown>) {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn<void, [Record<string, unknown>]>(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/execution/approvals/id/approve' }),
      }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(
      new ServiceUnavailableException(body),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(503);
    return response.json.mock.calls[0][0];
  }
  it('preserves the explicit no-submission marker for Privy sign-only failures', () => {
    expect(
      responseFor({
        message: 'No transaction was submitted.',
        code: 'PRIVY_SIGNING_FAILED',
        submissionState: 'not_submitted',
      }),
    ).toEqual(
      expect.objectContaining({
        code: 'PRIVY_SIGNING_FAILED',
        submissionState: 'not_submitted',
        message: 'No transaction was submitted.',
      }),
    );
  });
  it('does not classify arbitrary service outages as safe to repeat', () => {
    expect(responseFor('Service unavailable')).not.toHaveProperty(
      'submissionState',
    );
  });
});
