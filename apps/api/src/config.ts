export const config = {
  port: Number(process.env.PORT ?? 4000),
  env: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  appOrigin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
  sessionHours: Number(process.env.SESSION_HOURS ?? 10),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 60),
  staticDir: process.env.STATIC_DIR,
  // Secure cookies need HTTPS. Set COOKIE_SECURE=false only for a trial on a private network without HTTPS.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  timezone: 'Africa/Kampala',
};
