import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import crypto from 'crypto';

export interface UserPayload {
  id: string;
  email: string;
  jti?: string;
  exp?: number;
}

export interface MagicLinkPayload {
  email: string;
  jti: string;
}

export function generateMagicToken(email: string): string {
  const { randomUUID } = require('crypto');
  return jwt.sign({ email }, env.JWT_SECRET, { expiresIn: '15m', jwtid: randomUUID() });
}

export function generateSessionToken(user: Omit<UserPayload, 'jti' | 'exp'>): string {
  return jwt.sign({ id: user.id, email: user.email }, env.JWT_SECRET, { expiresIn: '7d', jwtid: crypto.randomUUID() });
}

export function verifyToken<T>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET) as T;
}
