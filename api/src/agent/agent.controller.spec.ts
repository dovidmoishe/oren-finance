import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AgentController } from './agent.controller';

describe('AgentController', () => {
  it('returns thread, message, artifacts, and events', async () => {
    const agent = {
      message: jest.fn().mockResolvedValue({
        threadId: 'thread-1',
        message: {
          id: 'msg-1',
          threadId: 'thread-1',
          role: 'assistant',
          content: 'Done',
          createdAt: new Date('2026-09-13T10:00:00Z'),
        },
        artifacts: [],
        events: [{ type: 'assistant_completed', timestamp: new Date() }],
      }),
    };
    const controller = new AgentController(
      agent as never,
      { require: jest.fn() } as never,
    );

    await expect(
      controller.message({ walletAddress: 'wallet-1', message: 'Hi' }),
    ).resolves.toMatchObject({
      threadId: 'thread-1',
      message: { content: 'Done' },
      artifacts: [],
      events: [{ type: 'assistant_completed' }],
    });
  });

  it('rejects missing wallet or message through the service contract', async () => {
    const agent = {
      message: jest.fn().mockRejectedValue(new BadRequestException()),
    };
    const controller = new AgentController(
      agent as never,
      { require: jest.fn() } as never,
    );

    await expect(
      controller.message({ walletAddress: '', message: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Creation history privacy', () => {
  const agent = { getThreadMessages: jest.fn(), message: jest.fn() },
    sessions = { require: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    agent.getThreadMessages.mockResolvedValue({
      messages: [
        {
          artifacts: [{ type: 'prediction_creation', data: { id: 'private' } }],
        },
      ],
    });
  });
  const controller = () =>
    new AgentController(agent as never, sessions as never);
  it('requires ownership both to restore private artifacts and continue their chat', async () => {
    sessions.require.mockImplementation(() => {
      throw new UnauthorizedException('Verify wallet');
    });
    const c = controller();
    await expect(
      c.getThreadMessages('thread', { walletAddress: 'owner' }),
    ).rejects.toThrow();
    await expect(
      c.message({
        walletAddress: 'owner',
        threadId: 'thread',
        message: 'Repeat draft details',
      }),
    ).rejects.toThrow();
    expect(agent.message).not.toHaveBeenCalled();
  });
  it('passes the session only as trusted runtime context after ownership verification', async () => {
    sessions.require.mockReturnValue('owner');
    const c = controller();
    await c.message(
      { walletAddress: 'owner', threadId: 'thread', message: 'Restore' },
      'verified-token',
    );
    expect(sessions.require).toHaveBeenCalledWith('verified-token', 'owner');
    expect(agent.message).toHaveBeenCalledWith(
      expect.objectContaining({ creationSessionToken: 'verified-token' }),
    );
  });
  it('keeps ordinary prediction discovery chats accessible without a creation session', async () => {
    agent.getThreadMessages.mockResolvedValue({
      messages: [{ artifacts: [{ type: 'prediction_market' }] }],
    });
    await controller().message({
      walletAddress: 'owner',
      threadId: 'thread',
      message: 'Discover',
    });
    expect(sessions.require).not.toHaveBeenCalled();
    expect(agent.message).toHaveBeenCalled();
  });
});
