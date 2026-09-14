/** Deletes the local database file so the next boot starts from a clean schema. */
import { existsSync, rmSync } from 'node:fs';
import { config } from '../env.js';

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
