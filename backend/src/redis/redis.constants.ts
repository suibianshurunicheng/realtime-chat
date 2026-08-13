/** Injection token for the shared ioredis client. Kept in its own file to avoid a
 *  circular import between RedisModule and RedisService (which would evaluate the
 *  token as `undefined` inside the @Inject() decorator). */
export const REDIS_CLIENT = 'REDIS_CLIENT';
