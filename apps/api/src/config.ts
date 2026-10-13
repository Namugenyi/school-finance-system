export const config = {
  port: Number(process.env.PORT ?? 4000),
  env: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  appOrigin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
  sessionHours: Number(process.env.SESSION_HOURS ?? 10),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 60),
  staticDir: process.env.STATIC_DIR,
  timezone: 'Africa/Kampala',
};
