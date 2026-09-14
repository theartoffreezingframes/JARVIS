import { buildServer, webRoot } from './server.js';
import { config, productionWarnings } from './env.js';
import { closeDb, migrate } from './db/index.js';
import { purgePasswordResets } from './repo/users.js';
import { closeEmailTransport, resolveTransport, verifyEmailTransport } from './services/email/index.js';

/**
 * API + realtime + optional static web host.
 *
 * Bound to 0.0.0.0 so containers, tunnels and the sandbox preview can reach it.
 * TLS is terminated by a reverse proxy (Caddy/nginx/Cloudflare/ALB) in
 * production — see docs/DEPLOYMENT.md; this process speaks HTTP behind it.
 */
async function main(): Promise<void> {
  // Safe to run on every boot: the schema is applied with `CREATE TABLE IF NOT
  // EXISTS` / additive migrations only, never a destructive rebuild.
  migrate();

  // Housekeeping keeps the reset table from growing forever.
  purgePasswordResets(Date.now() - 30 * 86_400_000);

  const { app } = await buildServer();

  for (const warning of productionWarnings()) app.log.warn(`[config] ${warning}`);

  const emailTransport = resolveTransport();
  app.log.info({ transport: emailTransport.description }, 'email transport');
  const emailStatus = await verifyEmailTransport();
  if (!emailStatus.ok) {
    // A configured-but-broken provider is an error; no provider at all is normal
    // in development and is warned about separately in production.
    const level = emailTransport.kind === 'none' ? 'warn' : 'error';
    app.log[level](`[config] ${emailStatus.detail}`);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    // Stop accepting work, drain in-flight requests and sockets, then close the
    // database so WAL contents are checkpointed cleanly.
    const hardExit = setTimeout(() => process.exit(1), 10_000);
    hardExit.unref();
    try {
      await app.close();
      await closeEmailTransport();
      closeDb();
      clearTimeout(hardExit);
      app.log.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandled promise rejection');
  });

  await app.listen({ port: config.port, host: config.host });
  const root = webRoot();
  app.log.info(
    {
      port: config.port,
      host: config.host,
      env: config.nodeEnv,
      web: root ?? 'none',
      db: config.databaseFile,
      publicUrl: config.publicUrl || '(JARVIS_PUBLIC_URL unset)',
      email: emailTransport.kind,
      push: config.push.enabled ? 'on' : 'off',
    },
    'JARVIS API ready',
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start JARVIS API', error instanceof Error ? error.message : error);
  process.exit(1);
});
