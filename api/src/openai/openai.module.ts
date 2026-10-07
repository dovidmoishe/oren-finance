import { Module } from '@nestjs/common';
import { OPENAI_CLIENT, openAiClientProvider } from './openai.provider';

@Module({ providers: [openAiClientProvider], exports: [OPENAI_CLIENT] })
export class OpenAiModule {}
