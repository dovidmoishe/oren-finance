import { Module } from '@nestjs/common';
import { PantaService } from './panta.service';

@Module({ providers: [PantaService], exports: [PantaService] })
export class PantaModule {}
