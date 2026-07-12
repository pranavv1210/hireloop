import { createApp } from './app.js';
import { config } from './config.js';
import { closeDatabase } from './db/database.js';
import { logger } from './logger.js';

const server = createApp().listen(config.port, () => {
  logger.info({ port: config.port }, 'HireLoop backend listening');
});

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'Shutting down backend');
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
