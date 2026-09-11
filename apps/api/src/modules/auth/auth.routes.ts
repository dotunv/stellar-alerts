import { FastifyInstance } from 'fastify';
import { authController } from './auth.controller';
import { authenticateHook } from '../../middleware/auth.middleware';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/request-link', authController.requestMagicLink.bind(authController));
  app.get('/auth/verify', authController.verifyMagicLink.bind(authController));
  app.post('/auth/did/challenge', authController.requestDIDChallenge.bind(authController));
  app.post('/auth/did/verify', authController.verifyDIDAuth.bind(authController));
  app.post('/auth/telegram', authController.verifyTelegramInitData.bind(authController));
  app.get('/auth/me', { preHandler: [authenticateHook] }, authController.getMe.bind(authController));
  app.post('/auth/logout', { preHandler: [authenticateHook] }, authController.logout.bind(authController));
}
