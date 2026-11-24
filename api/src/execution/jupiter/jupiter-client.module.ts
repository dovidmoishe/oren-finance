import { Module } from '@nestjs/common';
import { JupiterClient } from './jupiter.client';
import { JupiterGateway } from './jupiter-gateway';

/** Share the provider's rate budget between interactive orders and paper quotes. */
@Module({
  providers: [JupiterGateway, JupiterClient],
  exports: [JupiterGateway, JupiterClient],
})
export class JupiterClientModule {}
