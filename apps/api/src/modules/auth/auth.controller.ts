import { FastifyRequest, FastifyReply } from 'fastify';
import { requestLinkSchema, verifyLinkSchema, telegramInitDataSchema } from './auth.schema';
import { authService } from './auth.service';
import { TelegramInitDataError } from '../../utils/telegram';

export class AuthController {
  async requestMagicLink(request: FastifyRequest, reply: FastifyReply) {
    const parsed = requestLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid email', details: parsed.error.format() });
    }

    const token = await authService.requestMagicLink(parsed.data.email);
    return reply.send({
      success: true,
      message: 'If the email exists, a magic link was sent.',
      ...(process.env.NODE_ENV !== 'production' ? { token } : {}),
    });
  }

  async verifyMagicLink(request: FastifyRequest, reply: FastifyReply) {
    const parsed = verifyLinkSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid token parameter', details: parsed.error.format() });
    }

    try {
      const { token: sessionToken, user } = await authService.verifyMagicLink(parsed.data.token);
      return reply.send({ success: true, token: sessionToken, user });
    } catch (error: any) {
      if (error.message === 'Invalid or expired token') {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }
      return reply.status(500).send({ error: 'Internal server error', message: error.message });
    }
  }

  async requestDIDChallenge(request: FastifyRequest, reply: FastifyReply) {
    const { did } = (request.body as any) || {};
    if (!did || typeof did !== 'string') {
      return reply.status(400).send({ error: 'Invalid DID parameter' });
    }

    try {
      const challengeObj = authService.requestDIDChallenge(did);
      return reply.send({ success: true, ...challengeObj });
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  }

  async verifyDIDAuth(request: FastifyRequest, reply: FastifyReply) {
    const { did, challenge, signature } = (request.body as any) || {};
    if (!did || !challenge || !signature) {
      return reply.status(400).send({ error: 'Missing did, challenge, or signature parameters' });
    }

    try {
      const result = await authService.verifyDIDAuth(did, challenge, signature);
      return reply.send({ success: true, ...result });
    } catch (error: any) {
      return reply.status(401).send({ error: 'DID Authentication failed', message: error.message });
    }
  }

  /**
   * Authenticates a Telegram Mini App session from the client-provided
   * `initData` string (HMAC-SHA256 validated server-side). Returns a session
   * JWT identical in shape to the magic-link / DID responses.
   */
  async verifyTelegramInitData(request: FastifyRequest, reply: FastifyReply) {
    const parsed = telegramInitDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid initData parameter', details: parsed.error.format() });
    }

    try {
      const result = await authService.verifyTelegramInitData(parsed.data.initData);
      return reply.send({ success: true, ...result });
    } catch (error: any) {
      if (error instanceof TelegramInitDataError) {
        const status = error.code === 'INVALID_SIGNATURE' || error.code === 'EXPIRED' ? 401 : 400;
        return reply.status(status).send({
          error: 'Telegram authentication failed',
          code: error.code,
          message: error.message,
        });
      }
      return reply.status(500).send({ error: 'Internal server error', message: error.message });
    }
  }

  async getMe(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    try {
      const user = await authService.getMe(request.user.id);
      return reply.send({ success: true, user });
    } catch (error: any) {
      if (error.message === 'User not found') {
        return reply.status(404).send({ error: 'Not found', message: 'User not found' });
      }
      return reply.status(500).send({ error: 'Internal server error', message: error.message });
    }
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    try {
      await authService.revokeSession(request.user);
      return reply.send({ success: true, message: 'Logged out successfully.' });
    } catch (error: any) {
      return reply.status(500).send({ error: 'Internal server error', message: error.message });
    }
  }
}

export const authController = new AuthController();
