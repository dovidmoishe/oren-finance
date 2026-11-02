import { json, type Express } from 'express';

/** Custom /mcp routes precede Nest's default parser during app.listen(). */
export function registerMcpJsonBodyParser(app: Express) {
  app.use('/mcp', json({ limit: '100kb' }));
}
