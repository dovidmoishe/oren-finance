import type { AgentMessage, AgentThread } from '../../types/agent';
import { AgentService } from './agent.service';

function responseStream(response: Record<string, unknown>, deltas: string[] = []) {
  return (async function* () {
    for (const delta of deltas) {
      yield { type: 'response.output_text.delta', delta };
    }
    yield { type: 'response.completed', response };
  })();
}

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

  it('streams text, executes a tool, persists the answer, and extracts artifacts', async () => {
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'analyzeStock',
              call_id: 'call-1',
              arguments: '{"assetIdOrTicker":"NVDA"}',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        responseStream(
          {
            output_text: 'NVDA has a strong Oren Score.',
            output: [],
          },
          ['NVDA has ', 'a strong Oren Score.'],
        ),
      );
    tools.dispatch.mockResolvedValue({
      output: { assetId: 'nvda', ticker: 'NVDA', opportunityScore: 90 },
      artifact: {
        type: 'analysis',
        data: { assetId: 'nvda', ticker: 'NVDA', opportunityScore: 90 },
      },
    });

    const streamed = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message: 'Analyze NVDA',
      context: { page: 'stock', assetId: 'nvda' },
    })) {
      streamed.push(event);
    }

    expect(repository.createThread).toHaveBeenCalledWith('wallet-1');
    expect(tools.dispatch).toHaveBeenCalledWith('analyzeStock', {
      assetIdOrTicker: 'NVDA',
    });
    expect(streamed.map((event) => event.type)).toEqual([
      'turn_started',
      'tool_started',
      'tool_completed',
      'assistant_delta',
      'assistant_delta',
      'turn_completed',
    ]);
    expect(streamed.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(repository.insertMessage).toHaveBeenLastCalledWith({
      threadId: 'thread-1',
      role: 'assistant',
      content: 'NVDA has a strong Oren Score.',
    });
  });

  it('keeps the JSON endpoint in parity with the streaming runner', async () => {
    openai.responses.create.mockResolvedValue(
      responseStream({ output_text: 'Hello', output: [] }, ['Hel', 'lo']),
    );

    const result = await service.message({
      walletAddress: 'wallet-1',
      threadId: 'thread-1',
      message: 'Hi',
    });

    expect(repository.getThread).toHaveBeenCalledWith('thread-1');
    expect(repository.createThread).not.toHaveBeenCalled();
    expect(result.message.content).toBe('Hello');
    expect(result.events?.map((event) => event.type)).toEqual([
      'turn_started',
      'turn_completed',
    ]);
  });

  it('reuses an unanswered trailing user message on retry', async () => {
    const unanswered = {
      id: 'user-existing',
      threadId: 'thread-1',
      role: 'user' as const,
      content: 'Analyze NVDA',
      createdAt: new Date('2026-09-13T10:00:00Z'),
    };
    repository.listMessages.mockResolvedValue([unanswered]);
    openai.responses.create.mockResolvedValue(
      responseStream({ output_text: 'MU is ready.', output: [] }),
    );

    const events = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      threadId: 'thread-1',
      message: 'Analyze NVDA',
    })) {
      events.push(event);
    }

    expect(repository.insertMessage).toHaveBeenCalledTimes(1);
    expect(repository.insertMessage).toHaveBeenCalledWith({
      threadId: 'thread-1',
      role: 'assistant',
      content: 'MU is ready.',
    });
    expect(events[0]).toMatchObject({
      type: 'turn_started',
      message: { id: 'user-existing' },
    });
  });

  it('continues after a tool failure and reports the real failure state', async () => {
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'getStock',
              call_id: 'call-1',
              arguments: '{"assetIdOrTicker":"NOPE"}',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        responseStream({ output_text: 'I could not load that stock.', output: [] }),
      );
    tools.dispatch.mockRejectedValue(new Error('Unknown stock'));

    const events = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message: 'Analyze NOPE',
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'tool_failed')).toBe(true);
    expect(events.at(-1)?.type).toBe('turn_completed');
  });

  it('reconstructs display history and marks a trailing user turn interrupted', async () => {
    repository.listMessages.mockResolvedValue([
      {
        id: 'user-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'Analyze NVDA',
        createdAt: new Date('2026-09-13T10:00:00Z'),
      },
      {
        id: 'tool-1',
        threadId: 'thread-1',
        role: 'tool',
        toolName: 'analyzeStock',
        content: '{"ticker":"NVDA","opportunityScore":90}',
        createdAt: new Date('2026-09-13T10:00:01Z'),
      },
      {
        id: 'assistant-1',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'NVDA looks strong.',
        createdAt: new Date('2026-09-13T10:00:02Z'),
      },
      {
        id: 'user-2',
        threadId: 'thread-1',
        role: 'user',
        content: 'And the news?',
        createdAt: new Date('2026-09-13T10:00:03Z'),
      },
    ]);

    const result = await service.getThreadMessages('thread-1', 'wallet-1');

    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      activities: [{ toolName: 'analyzeStock', status: 'completed' }],
      artifacts: [{ type: 'analysis' }],
    });
    expect(result.messages.at(-1)).toMatchObject({ interrupted: true });
  });

  it('stops after max tool rounds', async () => {
    openai.responses.create.mockImplementation(() =>
      Promise.resolve(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'getStock',
              call_id: 'call-1',
              arguments: '{"assetIdOrTicker":"NVDA"}',
            },
          ],
        }),
      ),
    );
    tools.dispatch.mockResolvedValue({ output: { id: 'nvda' } });

    const result = await service.message({
      walletAddress: 'wallet-1',
      message: 'Keep looking',
    });

    expect(openai.responses.create).toHaveBeenCalledTimes(5);
    expect(result.message.content).toContain('tool limit');
  });
});
