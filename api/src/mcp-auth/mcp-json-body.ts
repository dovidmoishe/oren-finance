import {
  json,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

const parseMcpJson = json({ limit: '100kb' });

/**
 * Custom /mcp routes are mounted before Nest adds its parser in listen().
 *
 * The parser has to be scoped to /mcp so /oauth can keep reading the raw body.
 * It must not be the middleware function express.json() returns: that function
 * is named jsonParser, and Nest's ExpressAdapter treats any root middleware
 * with that name as the global JSON parser and then skips installing one.
 * Mounting it directly makes every other JSON POST, including both agent
 * message routes, arrive with an empty body.
 */
export function registerMcpJsonBodyParser(app: Express) {
  app.use(
    '/mcp',
    function mcpJsonParser(req: Request, res: Response, next: NextFunction) {
      parseMcpJson(req, res, next);
    },
  );
}
