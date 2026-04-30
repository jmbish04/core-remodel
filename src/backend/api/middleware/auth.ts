/**
 * @fileoverview Authentication middleware
 */

import type { Context, Next } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { sessions, users } from '../../db/schema';
import type { Bindings, Variables } from '../index';

export async function authMiddleware(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  const db = drizzle(c.env.DB);

  try {
    const sessionResult = await db
      .select({
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        email: users.email,
        name: users.name,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
      .limit(1);

    if (sessionResult.length === 0) {
      return c.json({ error: 'Invalid session' }, 401);
    }

    const session = sessionResult[0];

    if (session.expiresAt * 1000 < Date.now()) {
      return c.json({ error: 'Session expired' }, 401);
    }

    c.set('userId', session.userId);
    c.set('user', {
      id: session.userId,
      email: session.email,
      name: session.name,
    });

    await next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return c.json({ error: 'Authentication failed' }, 500);
  }
}
