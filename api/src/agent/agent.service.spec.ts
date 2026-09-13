import type { AgentMessage, AgentThread } from '../../types/agent';
import { AgentService } from './agent.service';

describe('AgentService', () => {
  const thread: AgentThread = {
    id: 'thread-1',
    walletAddress: 'wallet-1',
    createdAt: new Date('2026-09-13T10:00:00Z'),
    updatedAt: new Date('2026-09-13T10:00:00Z'),
  };

  const repository = {
    createThread: jest.fn(),
    getThread: jest.fn(),
    insertMessage: jest.fn(),
    listMessages: jest.fn(),
  };
  const tools = {
    getSchemas: jest.fn(),
    dispatch: jest.fn(),
  };
  const openai = {
    responses: {
      create: jest.fn(),
    },
  };

  let service: AgentService;
  let nextMessage = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    nextMessage = 0;
    repository.createThread.mockResolvedValue(thread);
    repository.getThread.mockResolvedValue(thread);
    repository.insertMessage.mockImplementation((input) =>
      Promise.resolve({
        id: `msg-${++nextMessage}`,
        createdAt: new Date('2026-09-13T10:00:00Z'),
        ...input,
      } satisfies AgentMessage),
    );
    repository.listMessages.mockResolvedValue([
      {
        id: 'msg-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'Analyze NVDA',
        createdAt: new Date('2026-09-13T10:00:00Z'),
      },
    ]);
    tools.getSchemas.mockReturnValue([]);
    service = new AgentService(
      repository as never,
      tools as never,
      { OPENAI_MODEL: 'gpt-5-mini' } as never,
      openai as never,
    );
  });

  it('creates a thread, stores messages, executes a tool, and extracts artifacts', async () => {
    openai.responses.create
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            name: 'analyzeStock',
            call_id: 'call-1',
            arguments: '{"assetIdOrTicker":"NVDA"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        output_text: 'NVDA has a strong Oren Score.',
        output: [],
      });
    tools.dispatch.mockResolvedValue({
      output: { assetId: 'nvda', ticker: 'NVDA', opportunityScore: 90 },
      artifact: {
        type: 'analysis',
        data: { assetId: 'nvda', ticker: 'NVDA', opportunityScore: 90 },
      },
    });

    const result = await service.message({
      walletAddress: 'wallet-1',
      message: 'Analyze NVDA',
    });

    expect(repository.createThread).toHaveBeenCalledWith('wallet-1');
    expect(tools.dispatch).toHaveBeenCalledWith('analyzeStock', {
      assetIdOrTicker: 'NVDA',
    });
    expect(result.threadId).toBe('thread-1');
    expect(result.message.content).toBe('NVDA has a strong Oren Score.');
    expect(result.artifacts).toEqual([
      {
        type: 'analysis',
        data: { assetId: 'nvda', ticker: 'NVDA', opportunityScore: 90 },
      },
    ]);
    expect(result.events?.map((event) => event.type)).toEqual([
      'message_received',
      'tool_started',
      'tool_completed',
      'assistant_completed',
    ]);
  });

  it('loads an existing thread when threadId is provided', async () => {
    openai.responses.create.mockResolvedValue({
      output_text: 'Hello',
      output: [],
    });

    await service.message({
      walletAddress: 'wallet-1',
      threadId: 'thread-1',
      message: 'Hi',
    });

    expect(repository.getThread).toHaveBeenCalledWith('thread-1');
    expect(repository.createThread).not.toHaveBeenCalled();
  });

  it('stops after max tool rounds', async () => {
    openai.responses.create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          name: 'getStock',
          call_id: 'call-1',
          arguments: '{"assetIdOrTicker":"NVDA"}',
        },
      ],
    });
    tools.dispatch.mockResolvedValue({ output: { id: 'nvda' } });

    const result = await service.message({
      walletAddress: 'wallet-1',
      message: 'Keep looking',
    });

    expect(openai.responses.create).toHaveBeenCalledTimes(5);
    expect(result.message.content).toContain('tool limit');
  });
});
