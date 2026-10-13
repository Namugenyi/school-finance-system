import { createApp } from './app';
import { config } from './config';
import { prisma } from './db';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`STJA finance API listening on port ${config.port} (${config.env})`);
});

const shutdown = () => {
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
