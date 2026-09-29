import jwt from 'jsonwebtoken';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import type { AuthInfo, OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { config } from '../config';
import type { AuthPayload } from '../middleware/auth';
import { logger } from '../utils/logger';

/**
 * Adapts Tally's existing JWT scheme (see middleware/auth.ts) to the MCP
 * server's OAuthTokenVerifier interface, so requireBearerAuth can validate
 * the same access tokens the REST API already issues — no separate OAuth
 * server, no new credential type.
 */
export const jwtTokenVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let payload: AuthPayload & { exp?: number };
    try {
      payload = jwt.verify(token, config.jwtSecret) as AuthPayload & { exp?: number };
    } catch (error) {
      logger.warn('MCP bearer token verification failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      // bearer-auth only maps OAuthError(InvalidToken) to a 401 — any other
      // thrown value surfaces as a 500.
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or expired token');
    }

    if (payload.type !== 'access') {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid token type');
    }

    return {
      token,
      clientId: payload.userId,
      scopes: [],
      // bearer-auth rejects tokens with no expiresAt, so fall back to the
      // JWT's own exp claim (always present — generateAccessToken signs
      // with expiresIn: '15m').
      expiresAt: payload.exp,
      extra: {
        userId: payload.userId,
        email: payload.email,
      },
    };
  },
};

/** Pulls the Tally userId back out of the AuthInfo a tool handler receives via ctx.http.authInfo. */
export function userIdFromAuthInfo(authInfo: AuthInfo | undefined): string {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== 'string' || !userId) {
    throw new Error('Missing authenticated user');
  }
  return userId;
}
