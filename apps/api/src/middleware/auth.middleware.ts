import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, UserPayload } from '../utils/jwt';
import { isTokenRevoked } from '../lib/tokenBlocklist';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserPayload;
  }
}

export async function authenticateHook(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'You must be logged in to perform this action.',
      code: 'AUTH_REQUIRED',
    });
  }

  const token = authHeader.split(' ')[1];
  let decoded: UserPayload;

  try {
    decoded = verifyToken<UserPayload>(token);
  } catch (error) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired session token.',
      code: 'INVALID_TOKEN',
    });
  }

  // Check Redis blocklist — reject if token has been explicitly revoked (logout).
  if (decoded.jti) {
    try {
      const revoked = await isTokenRevoked(decoded.jti);
      if (revoked) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Session has been revoked. Please log in again.',
          code: 'TOKEN_REVOKED',
        });
      }
    } catch (redisError: any) {
      // Fail-open: if Redis is unreachable, do not block the request.
      // Log the error so operators can investigate.
      request.log.error(`[Auth] Redis blocklist check failed: ${redisError.message}`);
    }
  }

  request.user = decoded;
}
