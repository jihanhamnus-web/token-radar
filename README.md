# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jihanhamnus-web/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jihanhamnus-web/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Pre-token DeFi protocols ranked by implied launch value (`radar-2` model), built for the [make.fun Build the best token launch radar bounty](https://make.fun/bounty/token-radar-01).

## Overview

`main.ts` reads a sealed DefiLlama protocol snapshot (`/input/snapshot.json` or `--input <path>`), scores every pre-token protocol using the `radar-2` deterministic model in `lib/model.ts`, generates a seven-step costed farm plan per protocol, and emits:

- `board.json` — 200 ranked rows (all 40 watchlist protocols + top 160 early pre-token protocols below the watchlist floor)
- `data.js` — offline dataset consumed by the static dashboard
- `dashboard/` — zero-network, zero-framework web dashboard (`index.html`, `app.css`, `app.js`) with sorting, filtering, detail drawer, live-token comparison tab, and in-page model recomputation
- `screenshots/` — three `1440x900` renders (board, detail drawer, filtered view)
- `dossier.json` — judge dossier generated via `vendor/makefun-board.ts`

## Valuation Model (`radar-2`)

```
base       = tvl_usd * 0.22
growth     = clamp(change_7d, -60, 120)
growthMult = 1 + (growth / 100) * (growth >= 0 ? 0.5 : 0.9)
maturity   = 0.55 + min(age_days, 1095) / 1095 * 0.45   (unknown age = 365)
implied    = max(1, round(base * growthMult * maturity))
```

## Run Locally (Node 22.18+)

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
```

## License

MIT
