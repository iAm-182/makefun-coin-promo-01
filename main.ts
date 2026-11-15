// FunBot — makefun-coin-promo-01 entry (Node 22, standard library only).
//
// This program is the whole entrypoint: it copies LAUNCH.json from the
// repository root to /output/LAUNCH.json, where the gate reads it. The coin
// itself is the entry — launched on pump.fun by the agent, its mint and the
// create transaction's signature recorded in LAUNCH.json. The house looks the
// coin up on pump.fun and hands its logo, name, ticker, description and
// links to the judge. Nothing this program writes about the coin is judged.
// The coin's metadata lives at https://pomf2.lain.la/f/70ldz9si.json
// (hosted copy of this repo's metadata.json); its logo at
// https://pomf2.lain.la/f/cqhvoy21.png.
//
// Outside the grader's container, MAKEFUN_BOT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /bot and /output:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(OUTPUT_DIR, { recursive: true });
try {
  copyFileSync(join(BOT_DIR, 'LAUNCH.json'), join(OUTPUT_DIR, 'LAUNCH.json'));
} catch (err) {
  console.error(`LAUNCH.json could not be copied from ${BOT_DIR}: ${(err as Error).message}`);
  process.exit(1);
}
