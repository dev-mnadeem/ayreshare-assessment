import { existsSync } from 'node:fs';

import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/database.js';
import { DEMO, seedDemoData } from '../db/seed.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const config = loadConfig();
const db = openDatabase(config.databasePath);
seedDemoData(db);
db.close();

process.stdout.write(
  [
    `Seeded demo data into ${config.databasePath}`,
    `  API Key (active account):       ${DEMO.apiKey}`,
    `  Profile-Key (creator profile):  ${DEMO.profileKeys.creator}`,
    `  Profile-Key (no TikTok ads):    ${DEMO.profileKeys.noTikTok}`,
    `  API Key (suspended account):    ${DEMO.suspendedApiKey}`,
    '',
  ].join('\n'),
);
