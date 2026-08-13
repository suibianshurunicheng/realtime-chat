import * as process from 'process';

export interface AppConfig {
  server: {
    port: number;
    nodeEnv: string;
  };
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
  redis: {
    host: string;
    port: number;
    password: string;
    db: number;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshExpiresInDays: number;
  };
  refreshCookie: {
    name: string;
    secure: boolean;
  };
  realtime: {
    /** Allowed Socket.IO CORS origins. Never `*`. Defaults to the dev Vite origin. */
    corsOrigins: string[];
  };
}

/**
 * Centralized configuration factory loaded by @nestjs/config (ConfigModule).
 * All values are overridable through environment variables (used by e2e tests).
 */
export default (): AppConfig => ({
  server: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
  },
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USERNAME ?? 'root',
    password: process.env.DB_PASSWORD ?? 'root',
    database: process.env.DB_DATABASE ?? 'realtime_chat',
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'change-me-access-secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresInDays: parseInt(process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? '7', 10),
  },
  refreshCookie: {
    name: process.env.REFRESH_COOKIE_NAME ?? 'rtc_refresh',
    secure: (process.env.REFRESH_COOKIE_SECURE ?? 'false') === 'true',
  },
  realtime: {
    corsOrigins: (process.env.RTC_CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
});
