import { Injectable } from '@nestjs/common';
import { ALCHEMY_HEALTH_PUBKEY } from '../config/constants';
import { DatabaseService } from '../database/database.provider';
import { TokensService } from '../tokens/tokens.service';
import { AlchemyService } from '../alchemy/alchemy.service';

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  status: HealthStatus;
  checks: {
    database: HealthCheckResult;
    tokens: HealthCheckResult;
    alchemy: HealthCheckResult;
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: TokensService,
    private readonly alchemy: AlchemyService,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, tokens, alchemy] = await Promise.all([
      this.checkDatabase(),
      this.checkTokens(),
      this.checkAlchemy(),
    ]);

    const results = [database, tokens, alchemy];
    const allOk = results.every((r) => r.ok);
    const allDown = results.every((r) => !r.ok);

    return {
      status: allOk ? 'ok' : allDown ? 'down' : 'degraded',
      checks: { database, tokens, alchemy },
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    try {
      const latencyMs = await this.database.ping();
      return { ok: true, latencyMs };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async checkTokens(): Promise<HealthCheckResult> {
    try {
      const result = await this.tokens.ping();
      return { ok: result.ok, latencyMs: result.latencyMs };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async checkAlchemy(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      await this.alchemy.getSolBalance(ALCHEMY_HEALTH_PUBKEY);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      try {
        return await this.alchemy.ping();
      } catch {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
}
