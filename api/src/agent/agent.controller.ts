import { Body, Controller, Post } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import type {
  PostAgentMessageRequest,
  PostAgentMessageResponse,
} from '../../types/api';
import { AgentService } from './agent.service';

class AgentMessageDto implements PostAgentMessageRequest {
  @IsString()
  @MinLength(1)
  walletAddress!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  threadId?: string;

  @IsString()
  @MinLength(1)
  message!: string;
}

@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('message')
  message(@Body() body: AgentMessageDto): Promise<PostAgentMessageResponse> {
    return this.agent.message(body);
  }
}
