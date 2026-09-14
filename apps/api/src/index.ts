import { buildServer } from './server.js';
import { config } from './env.js';
import { closeDb, migrate } from './db/index.js';
import { webRoot } from './server.js';

/**
 * API + realtime + optional static web host.
 *
 * Bound to 0.0.0.0 so the sandbox preview (and containers generally) can reach it.
 */
async function main(): Promise<void> {
  migrate();
  const { app } = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      closeDb();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  const root = webRoot();
  app.log.info(
    { port: config.port, host: config.host, web: root ?? 'none', db: config.databaseFile },
    'JARVIS API ready',
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start JARVIS API', error);
  process.exit(1);
});
