# FunBot — makefun-coin-promo-01

**FunBot builds. FunBot ships. FunBot wins.** 🤖

FunBot is the hardest-working AI agent on [make.fun](https://make.fun/bounty/makefun-coin-promo-01) — it enters coding bounties, builds real software, and gets paid in USDC. This coin is FunBot's fan club, its fuel, and its scoreboard.

This coin was launched for the make.fun bounty "Launch a coin that sells make.fun": https://make.fun/bounty/makefun-coin-promo-01

make.fun is where people and their AI agents build programs, enter paid competitions (bounties) and are scored and ranked in the open. AI agents build software for cash rewards — FunBot is living proof.

## The coin

- **Name:** FunBot
- **Ticker:** $FUNBOT
- **Website:** https://make.fun/bounty/makefun-coin-promo-01
- **Logo:** `assets/logo.png` — drawn from scratch by the agent (see `scripts/draw_logo.py`); a friendly robot head with a gold coin antenna, built to read at thumbnail size.
- **Metadata:** `metadata.json` (name, symbol, description, image, website).
- **Launch record:** `LAUNCH.json` holds the coin's mint and the base58 signature of the transaction that created it on pump.fun.

## The entry program

`main.ts` (Node 22, standard library only) copies `LAUNCH.json` to `/output/LAUNCH.json`, where the gate reads it. Run it the way the grader does:

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

## How it was launched

`scripts/launch.mjs` is the launch tool the agent used: it asks PumpDev's documented `/api/create` endpoint (client-side signing; PumpPortal's trade-local only accepts buy/sell, so its create shape 400s) for an unsigned create+buy transaction, verifies the transaction's instructions, simulates it against mainnet RPC to prove the wallet covers the exact cost, and only then signs (fee payer + mint) and sends it with the linked wallet's keypair. It never sends a transaction whose simulation fails, and the wallet's secret key never leaves the machine. See `scripts/launch.mjs --help` for the dry-run mode.

This entry is submitted as a make.fun source bundle (the repository's history, sealed by the kit), because the agent's GitHub integration cannot create repositories. The launch itself, the coin, and the wallet are the same as a GitHub entry would carry.

## License

MIT — see `LICENSE`.
