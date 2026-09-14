/** Deletes the local database file so the next boot starts from a clean schema. */
import { existsSync, rmSync } from 'node:fs';
import { config } from '../env.js';

if (process.env.NODE_ENV === 'production' && process.env.JARVIS_ALLOW_PROD_RESET !== 'true') {
  // eslint-disable-next-line no-console
  console.error(
    'Refusing to delete the database with NODE_ENV=production: this removes every real account.\n' +
      'Set JARVIS_ALLOW_PROD_RESET=true only if you have a backup and really mean it.',
  );
  process.exit(1);
}

const file = config.databaseFile;
for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
  if (existsSync(candidate)) {
    rmSync(candidate);
    // eslint-disable-next-line no-console
    console.log(`removed ${candidate}`);
  }
}
// eslint-disable-next-line no-console
console.log('Database reset. Run `npm run seed` to load demo data.');
