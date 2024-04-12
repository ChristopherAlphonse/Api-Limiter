import { Context, Env, Hono } from 'hono';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis/cloudflare';
import { env } from 'hono/adapter';
import { BlankInput } from 'hono/types';
import { data } from './data.json';

const app = new Hono();

declare module 'hono' {
  interface ContextVariableMap {
    ratelimit: Ratelimit;
  }
}

const cached = new Map();

class RedisLimiter {
  static instance: Ratelimit;
  static getInstance(c: Context<Env, 'groceries/:id', BlankInput>) {
    if (!this.instance) {
      const { REDIS_URL, REDIS_TOKEN } = env<{
        REDIS_URL: string;
        REDIS_TOKEN: string;
      }>(c);

      const redisClient = new Redis({
        token: REDIS_TOKEN,
        url: REDIS_URL,
      });

      const rateLimit = new Ratelimit({
        redis: redisClient,
        limiter: Ratelimit.slidingWindow(2, '2 s'),
        ephemeralCache: cached,
      });

      this.instance = rateLimit;
    }
    return this.instance;
  }
}

app.use(async (c, next) => {
  const ratelimit = RedisLimiter.getInstance(c);
  c.set('ratelimit', ratelimit);
  await next();
});

app.get('groceries/:id', async (c) => {
  try {
    const rateLimit = c.get('ratelimit');
    const ip = c.req.raw.headers.get('CF-Connecting-IP') ?? 'anonymous';
    const { success } = await rateLimit.limit(ip);

    if (success) {
      const Id = c.req.param('id');
      if (!Id) throw new Error('No id provided');
      const index = Number(Id);
      const bigData = data[index] ?? {
        message: 'No data exist for this query',
      };
      return c.json(bigData);
    } else {
      return c.json({ message: 'Too many requests' }, { status: 429 });
    }
  } catch (error) {
    return c.json({ message: 'Internal server failed' }, { status: 500 });
  }
});

app.get('/', async (c) => {
  try {
    const rateLimit = c.get('ratelimit');
    const ip = c.req.raw.headers.get('CF-Connecting-IP') ?? 'anonymous';
    const { success } = await rateLimit.limit(ip);

    if (success) {
      return c.json({ data });
    } else {
      return c.json({ message: 'Too many requests' }, { status: 429 });
    }
  } catch (error) {
    return c.json({ message: 'Internal server failed' }, { status: 500 });
  }
});

export default app;
