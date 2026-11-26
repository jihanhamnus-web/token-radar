# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jihanhamnus-web/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jihanhamnus-web/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Empirical peer-calibrated pre-token protocol radar (`peer-curve-v2`), built for the [make.fun Build the best token launch radar bounty](https://make.fun/bounty/token-radar-01).

## Overview

`main.ts` reads a sealed DefiLlama protocol snapshot (`/input/snapshot.json` or `--input <path>`), fits an IRLS Huber log-linear size-elasticity curve across all live-token peers in `snapshot.json` with Empirical-Bayes category residual shrinkage, validates out-of-sample accuracy via Leave-One-Out Cross-Validation (LOO-CV), and emits:

- `board.json` — 178 ranked pre-token rows (100% of the 40 watchlist protocols + 138 clean early pre-token protocols below the watchlist floor, excluding wrapped/staked/bridged/exchange products)
- `data.js` — offline dataset consumed by the static dashboard
- `dashboard/` — zero-network, zero-framework web dashboard (`index.html`, `app.css`, `app.js`) with inline SVG log-log calibration & category charts, sortable/filterable 8-column board, chain-aware farm plan drawer with in-page valuation recomputation, Live Benchmarks tab, and LOO-CV Methodology tab
- `screenshots/` — three `1440x900` renders (board, detail drawer, filtered view)
- `dossier.json` — judge dossier generated via `vendor/makefun-board.ts`

## Empirical Valuation Model (`peer-curve-v2`)

Fitted dynamically from all 119 live-token protocols (`mcap_usd > 0`, `tvl_usd > 0`, excluding `CEX`):

```
curveBase  = exp(alpha + beta * ln(tvl_usd))                     // Huber IRLS fit (~7.51 + 0.49 * ln TVL)
catMult    = exp((n_cat / (n_cat + 4)) * clamp(med_res_cat, -1, 1))
growthMult = 1 + (clamp(change_7d, -60, 120) / 100) * (g >= 0 ? 0.35 : 0.65)
maturity   = 0.70 + min(age_days, 1095) / 1095 * 0.30            // unknown age = 365d
chainMult  = 1 + min(4, max(0, chains.length - 1)) * 0.04
implied    = max(1, round(curveBase * catMult * growthMult * maturity * chainMult))
```

In Leave-One-Out CV across the 119 live peers, `peer-curve-v2` reduces median fold error from `4.80x` (naive `0.22x` TVL) to `3.75x` (`-21.9%`).

## Run Locally (Node 22.18+)

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
```

## License

MIT
