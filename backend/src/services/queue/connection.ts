import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

if (!process.env.REDIS_URL) {
  console.warn('[Queue] REDIS_URL not set in environment. Defaulting to redis://localhost:6379. In production on Render, set REDIS_URL to your managed Redis instance (e.g. Upstash).');
}

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    // Reconnect with exponential backoff, capped at 10 seconds
    const delay = Math.min(times * 500, 10000);
    return delay;
  },
  lazyConnect: false,
  enableOfflineQueue: false
});

let loggedRedisError = false;
connection.on('error', (err) => {
  if (!loggedRedisError) {
    console.error('[Redis connection error]:', err.message);
    loggedRedisError = true;
    setTimeout(() => { loggedRedisError = false; }, 30000); // Throttle logging to once per 30s
  }
});
