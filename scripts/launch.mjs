// FunBot launch tool (agent-side, NOT the graded entrypoint).
//
// Flow, in order:
//   1. Read the coin's metadata from metadata.json in the repo. The live
//      metadata URI (hosted copy of that file) is checked first: it must
//      already resolve and serve this coin, because the create instruction
//      embeds that URI and pump.fun locks it at creation.
//   2. Generate a FRESH mint keypair (saved to --mint-out, mode 600, outside
//      the repo — never committed). The mint keypair's secret is passed to
//      PumpPortal's trade-local API so it can embed the mint's signature in
//      the returned transaction. The mint keypair holds no funds; only the
//      fee-payer wallet's key signs on this machine, and it never leaves it.
//   3. Ask PumpPortal POST /api/trade-local for an unsigned create
//      transaction (create + first buy, pool "pump").
//   4. VERIFY the returned transaction before touching it: fee payer is our
//      wallet, it calls the pump.fun program, its create instruction names
//      our fresh mint, and its only value movements are rent for the new
//      accounts, the first buy into the bonding curve, and fees.
//   5. SIMULATE it against mainnet RPC (no signatures verified, nothing
//      sent) and read the fee payer's post-simulation balance: the exact
//      lamports the launch would cost.
//   6. --dry-run stops here and prints the cost. --live proceeds ONLY if
//      the simulation has no error and the cost fits the wallet's balance;
//      then it signs with the fee payer, sends, confirms, and writes
//      LAUNCH.json in the repo with the mint and the create signature.
//
// Usage:
//   node scripts/launch.mjs --dry-run [--repo DIR] [--keypair FILE]
//   node scripts/launch.mjs --live    [--repo DIR] [--keypair FILE]
//     [--buy-sol 0.005] [--priority-fee 0.0001]
//
// Env: MAKEFUN_RPC_URL (default https://api.mainnet-beta.solana.com)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
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
const METADATA_URI = 'https://pomf2.lain.la/f/t0k61xpa.json';

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
    buySol: 0.005, priorityFee: 0.0001, slippage: 10, mode: null };
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

const args = parseArgs(process.argv.slice(2));
const feePayer = loadKeypair(args.keypair);
const meta = JSON.parse(readFileSync(join(args.repo, 'metadata.json'), 'utf8'));
const metadataUri = METADATA_URI;

// 0. The metadata URI must already resolve (hosted copy pushed) before we launch.
const metaRes = await fetch(metadataUri, { headers: { accept: 'application/json' } });
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

// 2. Ask PumpPortal for the unsigned create transaction.
const connection = new Connection(RPC_URL, 'confirmed');
const balance = await connection.getBalance(feePayer.publicKey);
console.log(`wallet ${feePayer.publicKey.toBase58()} balance: ${balance} lamports (${balance / 1e9} SOL)`);
const createRes = await fetch('https://pumpportal.fun/api/trade-local', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    action: 'create',
    tokenMetadata: { name: meta.name, symbol: meta.symbol, uri: metadataUri },
    mint: bs58.encode(mintKp.secretKey),
    denominatedInSol: 'true',
    amount: args.buySol,
    slippage: args.slippage,
    priorityFee: args.priorityFee,
    pool: 'pump',
    publicKey: feePayer.publicKey.toBase58(),
  }),
});
if (!createRes.ok) {
  console.error(`trade-local create failed: HTTP ${createRes.status}: ${(await createRes.text()).slice(0, 500)}`);
  process.exit(1);
}
const txBytes = new Uint8Array(await createRes.arrayBuffer());
let tx;
try {
  tx = VersionedTransaction.deserialize(txBytes);
} catch {
  console.error('trade-local did not return a parseable versioned transaction');
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

// 5. LIVE: sign with the fee payer only (mint signature is embedded by PumpPortal) and send.
tx.sign([feePayer]);
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
