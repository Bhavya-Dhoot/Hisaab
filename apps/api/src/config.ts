import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// apps/api/src -> apps/api -> apps -> hisab (repo root)
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts');
export const DATA_DIR = path.join(REPO_ROOT, 'data');
export const RAW_DIR = path.join(DATA_DIR, 'raw');
export const DB_PATH = path.join(DATA_DIR, 'hisab.db');

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  webhookSecret: process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  leoRate: 83.65, // mock LEO-date USD->INR rate
  creditRate: 83.9, // mock credit-date USD->INR rate
  platformFeeBps: 35,
  toleranceBps: 200,
};
