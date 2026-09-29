import { Router } from 'express';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { jwtTokenVerifier } from './auth';
import { registerTallyTools } from './tools';

// A fresh McpServer per HTTP request (createMcpHandler's contract) — tool
// registration is cheap and this keeps requests fully isolated.
const mcpHandler = createMcpHandler(() => {
  const server = new McpServer({ name: 'tally', version: '1.0.0' });
  registerTallyTools(server);
  return server;
});

const nodeHandler = toNodeHandler(mcpHandler);

/**
 * Mounted at /mcp in index.ts. Reuses the existing JWT scheme (via
 * jwtTokenVerifier) rather than standing up a separate OAuth server — the
 * /chat endpoint forwards the user's own access token as authorization_token
 * on the mcp_servers config, so this middleware sees the same Bearer token
 * the REST API already accepts.
 */
export const mcpRouter = Router();

mcpRouter.use(requireBearerAuth({ verifier: jwtTokenVerifier }));

// express.json() is already mounted globally in index.ts, so req.body is
// pre-parsed by the time it reaches here — pass it through as parsedBody.
mcpRouter.all('/', (req, res) => {
  void nodeHandler(req, res, req.body);
});
