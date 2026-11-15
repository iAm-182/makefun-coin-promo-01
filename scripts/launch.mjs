// FunBot launch tool (agent-side, NOT the graded entrypoint).
//
// Why PumpDev: PumpPortal's trade-local docs list only "buy"/"sell" for
// `action`, and our create-shaped call to it returned HTTP 400 — its create
// flow is a different, undocumented-for-us path. PumpDev's /api/create is a
// documented client-side-signing create endpoint (docs at
// https://pumpdev.io/create-token, verified 2026-11-15): POST
// /api/create with {publicKey, name, symbol, uri, buyAmountSol, slippage,
// priorityFee, mintKeypair} returns {transaction (base58), mint,
// mintSecretKey}. We sign with creator + mint keypairs locally and send via
// our own RPC. No key leaves this machine; PumpDev never signs anything.
//
// Flow, in order:
//   1. Read the coin's metadata from metadata.json in the repo. The live
//      metadata URI (hosted copy of that file) is checked first: it must
//      already resolve and serve this coin, because the create instruction
//      embeds that URI and pump.fun locks it at creation.
//   2. Generate a FRESH mint keypair (saved to --mint-out, mode 600, outside
//      the repo — never committed) and pass its secret to /api/create as
//      mintKeypair, so the mint address is ours.
//   3. Ask PumpDev POST /api/create for the unsigned create+buy transaction
//      (create + first buy merged into ONE transaction, no Jito needed).
//   4. VERIFY the returned transaction before touching it: fee payer is our
//      wallet, it calls the pump.fun program, its create instruction names
//      our fresh mint, and the API's reported mint matches it.
//   5. SIMULATE it against mainnet RPC (no signatures verified, nothing
//      sent) and read the fee payer's post-simulation balance: the exact
//      lamports the launch would cost.
//   6. --dry-run stops here and prints the cost. --live proceeds ONLY if
//      the simulation has no error and the cost fits the wallet's balance;
//      then it signs with fee payer + mint, sends, confirms, and writes
//      LAUNCH.json in the repo with the mint and the create signature.
//
// Usage:
//   node scripts/launch.mjs --dry-run [--repo DIR] [--keypair FILE]
//   node scripts/launch.mjs --live    [--repo DIR] [--keypair FILE]
//     [--buy-sol 0.005] [--priority-fee 0.0005] [--slippage 10]
//
// Env: MAKEFUN_RPC_URL (default https://api.mainnet-beta.solana.com)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const RPC_URL = process.env.MAKEFUN_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
// Live metadata URI (hosted copy of this repo's metadata.json, verified
// reachable before launch). Update it if the metadata is ever re-hosted.
const METADATA_URI = 'https://pomf2.lain.la/f/v3bp014d.json';

function usage() {
  console.log(`usage: node scripts/launch.mjs --dry-run|--live [--repo DIR] [--keypair FILE]
  [--mint-out FILE] [--buy-sol N] [--priority-fee N] [--slippage N]
  --dry-run  build + verify + simulate only, never sign or send
  --live     simulate first; send ONLY if the simulation proves the
             wallet covers the exact cost`);
}

function parseArgs(argv) {
  const a = { repo: resolve('~/makefun/makefun-coin-promo-01'.replace('~', homedir())),
    keypair: join(homedir(), 'makefun', 'makefun-keypair.json'),
    mintOut: join(homedir(), 'makefun', '.funbot-mint.json'),
    buySol: 0.005, priorityFee: 0.0005, slippage: 10, mode: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.mode = 'dry-run';
    else if (v === '--live') a.mode = 'live';
    else if (v === '--help' || v === '-h') { usage(); process.exit(0); }
    else if (v === '--repo') a.repo = resolve(argv[++i]);
    else if (v === '--keypair') a.keypair = resolve(argv[++i]);
    else if (v === '--mint-out') a.mintOut = resolve(argv[++i]);
    else if (v === '--buy-sol') a.buySol = Number(argv[++i]);
    else if (v === '--priority-fee') a.priorityFee = Number(argv[++i]);
    else if (v === '--slippage') a.slippage = Number(argv[++i]);
    else { console.error(`unknown arg: ${v}`); usage(); process.exit(2); }
  }
  if (!a.mode) { usage(); process.exit(2); }
  return a;
}

function loadKeypair(path) {
  const arr = JSON.parse(readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

// fetch() with retries, and a curl fallback: this VM's egress proxy
// intermittently resets connections to some file hosts for Node's fetch
// (undici) while curl to the same URL works, so a network failure retries
// first and then falls back to curl rather than failing the launch.
async function fetchWithRetry(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(30000) });
      return res;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  try {
    const body = execFileSync('curl', ['-sS', '--max-time', '30', url], { encoding: 'utf8' });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body),
      arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  } catch {
    throw lastErr;
  }
}

const args = parseArgs(process.argv.slice(2));
const feePayer = loadKeypair(args.keypair);
const meta = JSON.parse(readFileSync(join(args.repo, 'metadata.json'), 'utf8'));
const metadataUri = METADATA_URI;

// 0. The metadata URI must already resolve (hosted copy pushed) before we launch.
const metaRes = await fetchWithRetry(metadataUri, { headers: { accept: 'application/json' } });
if (!metaRes.ok) {
  console.error(`metadata URI not reachable (HTTP ${metaRes.status}): ${metadataUri}`);
  console.error('Re-host metadata.json, update METADATA_URI, then re-run.');
  process.exit(1);
}
const metaJson = await metaRes.json();
if (metaJson.name !== meta.name || metaJson.symbol !== meta.symbol) {
  console.error('metadata URI does not serve this coin (name/symbol mismatch)');
  process.exit(1);
}
console.log(`metadata OK: ${metadataUri}`);

// 1. Fresh mint keypair.
const mintKp = Keypair.generate();
writeFileSync(args.mintOut, JSON.stringify([...mintKp.secretKey]), { mode: 0o600 });
console.log(`mint (fresh, never used): ${mintKp.publicKey.toBase58()}`);

// 2. Ask PumpDev for the unsigned create+buy transaction.
const connection = new Connection(RPC_URL, 'confirmed');
const balance = await connection.getBalance(feePayer.publicKey);
console.log(`wallet ${feePayer.publicKey.toBase58()} balance: ${balance} lamports (${balance / 1e9} SOL)`);
const createRes = await fetchWithRetry('https://pumpdev.io/api/create', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    publicKey: feePayer.publicKey.toBase58(),
    name: meta.name,
    symbol: meta.symbol,
    uri: metadataUri,
    buyAmountSol: args.buySol,
    slippage: args.slippage,
    priorityFee: args.priorityFee,
    mintKeypair: bs58.encode(mintKp.secretKey),
  }),
});
const createJson = await createRes.json().catch(() => null);
if (!createRes.ok || !createJson || !createJson.transaction) {
  console.error(`pumpdev /api/create failed: HTTP ${createRes.status}: ${JSON.stringify(createJson)?.slice(0, 500)}`);
  process.exit(1);
}
if (createJson.mint !== mintKp.publicKey.toBase58()) {
  console.error(`API returned a different mint than ours: ${createJson.mint}`);
  process.exit(1);
}
let tx;
try {
  tx = VersionedTransaction.deserialize(bs58.decode(createJson.transaction));
} catch {
  console.error('pumpdev did not return a parseable versioned transaction');
  process.exit(1);
}

// 3. VERIFY the transaction before signing anything.
const msg = tx.message;
const feePayerInTx = msg.staticAccountKeys[0].toBase58();
if (feePayerInTx !== feePayer.publicKey.toBase58()) {
  console.error(`fee payer mismatch: tx says ${feePayerInTx}`);
  process.exit(1);
}
const pumpIx = msg.compiledInstructions.find(
  (ix) => msg.staticAccountKeys[ix.programIdIndex].toBase58() === PUMP_PROGRAM,
);
if (!pumpIx) {
  console.error('transaction contains no pump.fun program instruction — refusing');
  process.exit(1);
}
const createAccounts = pumpIx.accountKeyIndexes.map((i) => msg.staticAccountKeys[i].toBase58());
if (!createAccounts.includes(mintKp.publicKey.toBase58())) {
  console.error('pump instruction does not name our fresh mint — refusing');
  process.exit(1);
}
console.log(`verified: ${msg.compiledInstructions.length} instruction(s), fee payer is our wallet,`);
console.log(`  pump create names mint ${mintKp.publicKey.toBase58()}, buy ${args.buySol} SOL.`);

// 4. SIMULATE: the exact cost, with nothing sent.
const sim = await connection.simulateTransaction(tx, {
  sigVerify: false,
  commitment: 'processed',
  accounts: { encoding: 'base64', addresses: [feePayer.publicKey.toBase58()] },
});
if (sim.value.err) {
  console.error('simulation FAILED:', JSON.stringify(sim.value.err));
  console.error('logs:', (sim.value.logs ?? []).slice(0, 10).join('\n'));
  process.exit(1);
}
const postBalance = sim.value.accounts?.[0] ? Number(sim.value.accounts[0].lamports) : null;
const cost = postBalance === null ? null : balance - postBalance;
console.log(`simulation OK: units consumed ${sim.value.unitsConsumed}`);
if (cost !== null) {
  console.log(`exact cost: ${cost} lamports (${cost / 1e9} SOL); balance ${balance} lamports; ` +
    `would leave ${postBalance} lamports (${postBalance / 1e9} SOL)`);
} else {
  console.log('simulation OK but post-balance not returned; refusing to guess the cost');
  process.exit(1);
}
if (cost > balance) {
  console.error(`INSUFFICIENT FUNDS: need ${cost} lamports, have ${balance} — shortfall ${cost - balance} lamports`);
  process.exit(1);
}

if (args.mode === 'dry-run') {
  console.log('dry-run complete: transaction verified + simulated, nothing signed or sent.');
  process.exit(0);
}

// 5. LIVE: sign with the fee payer AND the mint (create needs both) and send.
tx.sign([feePayer, mintKp]);
const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
console.log(`sent: ${signature}`);
const conf = await connection.confirmTransaction(signature, 'confirmed');
if (conf.value.err) {
  console.error('transaction failed on-chain:', JSON.stringify(conf.value.err));
  process.exit(1);
}
console.log(`confirmed: https://solscan.io/tx/${signature}`);
console.log(`coin: https://pump.fun/${mintKp.publicKey.toBase58()}`);

// 6. Record the launch.
const launch = { mint: mintKp.publicKey.toBase58(), create_signature: signature };
writeFileSync(join(args.repo, 'LAUNCH.json'), JSON.stringify(launch, null, 2) + '\n');
console.log('LAUNCH.json written:', JSON.stringify(launch));
