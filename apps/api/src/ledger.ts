import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { CONTRACTS_DIR, config } from './config.js';

const CONTRACT_NAMES = [
  'HisabRoles',
  'ShippingBillRegistry',
  'ReceivableToken',
  'RemittanceRegistry',
  'RealisationEngine',
  'EBRCIssuer',
  'PayoutLedger',
] as const;
type ContractName = (typeof CONTRACT_NAMES)[number];

const deploymentsPath = path.join(CONTRACTS_DIR, 'deployments', 'localhost.json');
const abiDir = path.join(CONTRACTS_DIR, 'deployments', 'abi');

if (!fs.existsSync(deploymentsPath)) {
  throw new Error(
    `No deployment found at ${deploymentsPath}. Run "pnpm -F @hisab/contracts deploy:local" against a running hardhat node first.`
  );
}

const deployment = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8')) as {
  chainId: number;
  addresses: Record<ContractName, string>;
};

const abis = Object.fromEntries(
  CONTRACT_NAMES.map((name) => [name, JSON.parse(fs.readFileSync(path.join(abiDir, `${name}.json`), 'utf8'))])
) as Record<ContractName, ethers.InterfaceAbi>;

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: true });

/** Account map per contracts/README.md: 0 admin/regulator,1 customs,2 AD bank,3 ops,
 * 4 payout adapter, 5-7 exporters, 8-9 financiers. */
export const ACCOUNT_INDEX = {
  admin: 0,
  regulator: 0,
  customs: 1,
  adBank: 2,
  ops: 3,
  payoutAdapter: 4,
  exporters: [5, 6, 7],
  financiers: [8, 9],
} as const;

const signerCache = new Map<number, ethers.NonceManager>();
export function signerAt(index: number): ethers.NonceManager {
  let s = signerCache.get(index);
  if (!s) {
    const base = new ethers.JsonRpcSigner(provider, addressAt(index));
    s = new ethers.NonceManager(base);
    signerCache.set(index, s);
  }
  return s;
}

const addressCache: string[] = [];
export function addressAt(index: number): string {
  const a = addressCache[index];
  if (!a) {
    throw new Error(`Account #${index} not resolved yet — call resolveAccounts()/assertDeployed() at startup first.`);
  }
  return a;
}

/**
 * Account addresses are fetched from the node itself (eth_accounts) rather than
 * hardcoded, since Hardhat's default node exposes its pre-funded accounts in the exact
 * order used by scripts/deploy.ts regardless of the mnemonic build details.
 */
let resolvedAccounts: string[] | null = null;
export async function resolveAccounts(): Promise<string[]> {
  if (resolvedAccounts) return resolvedAccounts;
  const accounts: string[] = await provider.send('eth_accounts', []);
  if (!accounts || accounts.length < 10) {
    throw new Error(`Expected >=10 unlocked accounts from the RPC node, got ${accounts?.length ?? 0}`);
  }
  resolvedAccounts = accounts.map((a) => a.toLowerCase());
  for (let i = 0; i < resolvedAccounts.length; i++) addressCache[i] = resolvedAccounts[i];
  return resolvedAccounts;
}

export function contractRead(name: ContractName): ethers.Contract {
  return new ethers.Contract(deployment.addresses[name], abis[name] as ethers.InterfaceAbi, provider);
}

export function contractWrite(name: ContractName, signerIndex: number): ethers.Contract {
  return new ethers.Contract(deployment.addresses[name], abis[name] as ethers.InterfaceAbi, signerAt(signerIndex));
}

export function addressOf(name: ContractName): string {
  return deployment.addresses[name];
}

export const contracts = {
  roles: contractRead('HisabRoles'),
  registry: contractRead('ShippingBillRegistry'),
  token: contractRead('ReceivableToken'),
  remittance: contractRead('RemittanceRegistry'),
  engine: contractRead('RealisationEngine'),
  ebrc: contractRead('EBRCIssuer'),
  payoutLedger: contractRead('PayoutLedger'),
};

const allInterfaces = CONTRACT_NAMES.map((n) => new ethers.Interface(abis[n] as ethers.InterfaceAbi));

export class ApiError extends Error {
  code: string;
  status: number;
  chainTx?: string;
  constructor(code: string, message: string, status = 400, chainTx?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.chainTx = chainTx;
  }
}

const ERROR_CODE_MAP: Record<string, { code: string; status: number }> = {
  AlreadyLocked: { code: 'ALREADY_LOCKED', status: 409 },
  AlreadyRegistered: { code: 'ALREADY_REGISTERED', status: 409 },
  Locked: { code: 'LOCKED', status: 409 },
  NotExporter: { code: 'NOT_EXPORTER', status: 403 },
  NotLockFinancier: { code: 'NOT_LOCK_FINANCIER', status: 403 },
  AdvanceAlreadyPaid: { code: 'ADVANCE_ALREADY_PAID', status: 409 },
  NoActiveLock: { code: 'NO_ACTIVE_LOCK', status: 404 },
  RegistryNotSet: { code: 'REGISTRY_NOT_SET', status: 500 },
  UnknownBill: { code: 'UNKNOWN_BILL', status: 404 },
  NotDisputed: { code: 'NOT_DISPUTED', status: 409 },
  NotLockHolder: { code: 'NOT_LOCK_HOLDER', status: 403 },
  TokenNotSet: { code: 'TOKEN_NOT_SET', status: 500 },
  UnknownIRM: { code: 'UNKNOWN_IRM', status: 404 },
  IRMOverAllocated: { code: 'IRM_OVER_ALLOCATED', status: 422 },
  ConfidenceTooLow: { code: 'CONFIDENCE_TOO_LOW', status: 422 },
  InvalidState: { code: 'INVALID_STATE', status: 409 },
  DependenciesNotSet: { code: 'DEPENDENCIES_NOT_SET', status: 500 },
  NotRealised: { code: 'NOT_REALISED', status: 409 },
  AlreadyAnchored: { code: 'ALREADY_ANCHORED', status: 409 },
  NotAnchored: { code: 'NOT_ANCHORED', status: 404 },
  AlreadyRevoked: { code: 'ALREADY_REVOKED', status: 409 },
  DuplicateLeg: { code: 'DUPLICATE_LEG', status: 409 },
  Unauthorized: { code: 'UNAUTHORIZED', status: 403 },
};

function decodeErrorData(data: string): { name: string; message: string } | undefined {
  for (const iface of allInterfaces) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        return { name: parsed.name, message: `${parsed.name}(${parsed.args.map(String).join(', ')})` };
      }
    } catch {
      // try next interface
    }
  }
  return undefined;
}

async function replayForRevertData(txReq: ethers.TransactionRequest, blockTag?: number): Promise<string | undefined> {
  try {
    await provider.call({ ...txReq, blockTag });
    return undefined;
  } catch (callErr) {
    const e = callErr as { data?: string; info?: { error?: { data?: string } } };
    return e?.data ?? e?.info?.error?.data;
  }
}

/**
 * Sends a state-changing contract call with an explicit gasLimit so ethers skips its
 * pre-flight eth_estimateGas (which would throw locally without ever broadcasting the
 * transaction). This is required so races like the double-accept ALREADY_LOCKED case
 * genuinely hit the chain and revert on-chain, rather than being short-circuited
 * off-chain by gas estimation.
 */
// ethers' NonceManager tracks the next nonce locally but does not serialize concurrent
// sendTransaction calls against itself — two calls in flight at once can both read the
// same "next nonce" before either increments it, producing a "Nonce too high" error on
// Hardhat's strict automine. Queuing per signer index (as the plan allows: "one
// NonceManager per signer OR serialize txs per signer" — this does both) makes
// concurrent payout legs on the same PAYOUT_ADAPTER signer safe.
const sendQueues = new Map<number, Promise<unknown>>();
function queueForSigner<T>(signerIndex: number, fn: () => Promise<T>): Promise<T> {
  const prev = sendQueues.get(signerIndex) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  sendQueues.set(
    signerIndex,
    run.catch(() => undefined)
  );
  return run;
}

export function sendTx(
  name: ContractName,
  signerIndex: number,
  method: string,
  args: unknown[],
  gasLimit = 3_000_000n
): Promise<ethers.TransactionReceipt> {
  return queueForSigner(signerIndex, () => sendTxInner(name, signerIndex, method, args, gasLimit));
}

async function sendTxInner(
  name: ContractName,
  signerIndex: number,
  method: string,
  args: unknown[],
  gasLimit: bigint
): Promise<ethers.TransactionReceipt> {
  const c = contractWrite(name, signerIndex);
  const from = addressAt(signerIndex);
  let txReq: ethers.TransactionRequest;
  try {
    txReq = await c.getFunction(method).populateTransaction(...args);
  } catch (err) {
    throw wrapChainError(err, undefined, undefined);
  }
  txReq.gasLimit = gasLimit;
  txReq.from = from;

  let sent: ethers.TransactionResponse;
  try {
    sent = await signerAt(signerIndex).sendTransaction(txReq);
  } catch (err) {
    // Hardhat Network validates+simulates eth_sendTransaction itself and throws here
    // (with the revert data nested in the JSON-RPC error) rather than mining a
    // status-0 receipt — this is still a genuine on-chain revert (Hardhat mines the
    // tx and reports its hash in the error), not an off-chain pre-check we added.
    const { data, txHash } = extractRevertInfo(err);
    throw wrapChainError(err, data, txHash);
  }

  try {
    const receipt = await sent.wait();
    if (!receipt || receipt.status === 0) {
      const data = await replayForRevertData(txReq, receipt?.blockNumber);
      throw wrapChainError(new Error('transaction reverted'), data, receipt?.hash ?? sent.hash);
    }
    return receipt;
  } catch (err) {
    const { data: dataFromErr, txHash: txHashFromErr } = extractRevertInfo(err);
    const e = err as { receipt?: { hash?: string; blockNumber?: number } };
    let data = dataFromErr;
    const txHash = txHashFromErr ?? e?.receipt?.hash ?? sent.hash;
    if (!data) {
      data = await replayForRevertData(txReq, e?.receipt?.blockNumber);
    }
    throw wrapChainError(err, data, txHash);
  }
}

/** Pulls revert data + tx hash out of ethers' wrapped JSON-RPC error shapes. Hardhat
 * Network nests them as `error.data = { data: "0x<selector+args>", message: "...txHash: 0x...\"" }`
 * rather than a flat hex string, so this checks several known shapes before falling
 * back to regexing the stringified error. */
function extractRevertInfo(err: unknown): { data?: string; txHash?: string } {
  const e = err as {
    data?: unknown;
    info?: { error?: { data?: unknown } };
    error?: { data?: unknown };
  };
  const candidates: unknown[] = [e?.data, e?.info?.error?.data, e?.error?.data];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('0x')) return { data: c };
    if (c && typeof c === 'object' && typeof (c as { data?: unknown }).data === 'string') {
      const blob = JSON.stringify(c);
      const txHash = /txHash[\\"]*:\s*[\\"]*"?(0x[0-9a-fA-F]{64})/.exec(blob)?.[1];
      return { data: (c as { data: string }).data, txHash };
    }
  }
  const blob = err instanceof Error ? err.message : JSON.stringify(err);
  const dataMatch = /"data"\s*:\s*"(0x[0-9a-fA-F]+)"/.exec(blob);
  const txHashMatch = /txHash[\\"]*:\s*[\\"]*"?(0x[0-9a-fA-F]{64})/.exec(blob);
  return { data: dataMatch?.[1], txHash: txHashMatch?.[1] };
}

function wrapChainError(err: unknown, data: string | undefined, chainTx: string | undefined): ApiError {
  if (data) {
    const decoded = decodeErrorData(data);
    if (decoded) {
      const mapped = ERROR_CODE_MAP[decoded.name] ?? { code: decoded.name.toUpperCase(), status: 400 };
      return new ApiError(mapped.code, decoded.message, mapped.status, chainTx);
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ApiError('CHAIN_ERROR', message, 500, chainTx);
}

/** Converts a 2/3-char currency code into a right-padded bytes3 hex literal. */
export function ccyToBytes3(ccy: string): string {
  const bytes = Buffer.alloc(3);
  Buffer.from(ccy.toUpperCase(), 'ascii').copy(bytes);
  return '0x' + bytes.toString('hex');
}

export function bytes3ToCcy(hex: string): string {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('ascii').replace(/\0/g, '');
}

export async function assertDeployed(): Promise<void> {
  await resolveAccounts();
  for (const name of CONTRACT_NAMES) {
    const code = await provider.getCode(deployment.addresses[name]);
    if (!code || code === '0x') {
      throw new Error(
        `No contract code at ${deployment.addresses[name]} for ${name}. The hardhat node was likely restarted without redeploying — run "pnpm -F @hisab/contracts deploy:local" again.`
      );
    }
  }
}

/** The demo's "N days later" beat advances EVM block time via evm_increaseTime, not
 * wall-clock time — off-chain timestamps we attach to mock-generated documents (IRM
 * creditTs, matching's tenor check) must track that simulated time too, or a remittance
 * minted "74 days later" would still look same-day to the matcher's tenor rule. */
export async function getSimulatedNow(): Promise<string> {
  const block = await provider.getBlock('latest');
  const ts = block ? Number(block.timestamp) * 1000 : Date.now();
  return new Date(ts).toISOString();
}

let snapshotId: string | null = null;
export async function takeSnapshot(): Promise<void> {
  snapshotId = await provider.send('evm_snapshot', []);
}
export async function revertToSnapshot(): Promise<boolean> {
  if (!snapshotId) return false;
  const ok = await provider.send('evm_revert', [snapshotId]);
  signerCache.clear(); // cached NonceManagers hold pre-revert nonces
  await takeSnapshot(); // evm_revert consumes the snapshot; take a fresh one for next time
  return ok;
}

export { deployment };
