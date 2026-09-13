import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  AgentArtifact,
  AgentChatRequest,
  AgentChatResponse,
  AgentEvent,
  AgentMessage,
} from '../../types/agent';
import { AgentUnavailableError } from '../common/errors/provider.errors';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { OREN_AGENT_PROMPT } from './agent.prompt';
import { AgentRepository } from './agent.repository';
import {
  OPENAI_CLIENT,
  type OpenAIClient,
} from './openai.provider';
import { AgentToolRegistry } from './tools/agent-tool.registry';

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 20;

type ResponseInput = unknown[];
type ResponseOutputItem = Record<string, unknown>;

@Injectable()
export class AgentService {
  constructor(
    private readonly repository: AgentRepository,
    private readonly tools: AgentToolRegistry,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAIClient,
  ) {}

  async message(body: AgentChatRequest): Promise<AgentChatResponse> {
    const walletAddress = assertNonEmpty(body.walletAddress, 'walletAddress');
    const content = assertNonEmpty(body.message, 'message');
    const thread = body.threadId
      ? await this.loadThread(body.threadId, walletAddress)
      : await this.repository.createThread(walletAddress);

    const userMessage = await this.repository.insertMessage({
      threadId: thread.id,
      role: 'user',
      content,
    });

    const events: AgentEvent[] = [
      {
        type: 'message_received',
        timestamp: new Date(),
        messageId: userMessage.id,
      },
    ];

    if (!this.openai) {
      throw new AgentUnavailableError('OPENAI_API_KEY is required for Agent');
    }

    const history = await this.repository.listMessages(thread.id, HISTORY_LIMIT);
    let input: ResponseInput = messagesToInput(history);
    const artifacts: AgentArtifact[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.openai.responses.create({
        model: this.env.OPENAI_MODEL,
        instructions: OREN_AGENT_PROMPT,
        input,
        tools: this.tools.getSchemas() as never,
        tool_choice: 'auto',
      } as never) as unknown as {
        output?: ResponseOutputItem[];
        output_text?: string;
      };

      const output = response.output ?? [];
      const functionCalls = output.filter(isFunctionCall);

      if (functionCalls.length === 0) {
        const assistant = await this.saveAssistantMessage(
          thread.id,
          extractAssistantText(response.output_text, output),
        );
        events.push({
          type: 'assistant_completed',
          timestamp: new Date(),
          messageId: assistant.id,
        });
        return compactResponse(thread.id, assistant, artifacts, events);
      }

      input = [...input, ...output];

      for (const call of functionCalls) {
        const toolName = String(call.name);
        events.push({
          type: 'tool_started',
          timestamp: new Date(),
          toolName,
        });

        try {
          const args = parseArguments(call.arguments);
          const result = await this.tools.dispatch(toolName, args);
          await this.repository.insertMessage({
            threadId: thread.id,
            role: 'tool',
            content: JSON.stringify(result.output),
            toolName,
            toolPayload: args,
          });
          if (result.artifact) artifacts.push(result.artifact);
          events.push({
            type: 'tool_completed',
            timestamp: new Date(),
            toolName,
          });
          input.push(functionOutput(call, result.output));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.repository.insertMessage({
            threadId: thread.id,
            role: 'tool',
            content: JSON.stringify({ error: message }),
            toolName,
            toolPayload: { failed: true },
          });
          events.push({
            type: 'tool_failed',
            timestamp: new Date(),
            toolName,
            error: message,
          });
          input.push(functionOutput(call, { error: message }));
        }
      }
    }

    const assistant = await this.saveAssistantMessage(
      thread.id,
      'I hit my tool limit before I could complete that. Try narrowing the request.',
    );
    events.push({
      type: 'assistant_completed',
      timestamp: new Date(),
      messageId: assistant.id,
    });
    return compactResponse(thread.id, assistant, artifacts, events);
  }

  private async loadThread(id: string, walletAddress: string) {
    const thread = await this.repository.getThread(id);
    if (!thread) throw new BadRequestException('threadId not found');
    if (thread.walletAddress !== walletAddress) {
      throw new BadRequestException('threadId does not belong to walletAddress');
    }
    return thread;
  }

  private saveAssistantMessage(
    threadId: string,
    content: string,
  ): Promise<AgentMessage> {
    return this.repository.insertMessage({
      threadId,
      role: 'assistant',
      content,
    });
  }
}

function messagesToInput(messages: AgentMessage[]): ResponseInput {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function isFunctionCall(item: ResponseOutputItem): item is ResponseOutputItem & {
  name: string;
  call_id: string;
  arguments?: string;
} {
  return item.type === 'function_call' && typeof item.name === 'string';
}

function parseArguments(args: unknown): unknown {
  if (typeof args !== 'string' || !args.trim()) return {};
  return JSON.parse(args);
}

function functionOutput(
  call: ResponseOutputItem & { call_id: string },
  output: unknown,
) {
  return {
    type: 'function_call_output',
    call_id: call.call_id,
    output: JSON.stringify(output),
  };
}

function extractAssistantText(
  outputText: string | undefined,
  output: ResponseOutputItem[],
): string {
  if (outputText?.trim()) return outputText.trim();

  const chunks: string[] = [];
  for (const item of output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content as Record<string, unknown>[]) {
      if (typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim() || 'I could not produce a response.';
}

function compactResponse(
  threadId: string,
  message: AgentMessage,
  artifacts: AgentArtifact[],
  events: AgentEvent[],
): AgentChatResponse {
  return {
    threadId,
    message,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    events,
  };
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim();
}
