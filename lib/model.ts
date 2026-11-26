// Empirical peer-calibrated pre-token valuation model (`peer-curve-v2`).
//
// Fits an IRLS Huber log-linear size curve ln(mcap) = alpha + beta * ln(tvl) across all live-token
// protocols in snapshot.json, applies Empirical-Bayes category residual shrinkage, adjusts for
// 7-day TVL momentum, track-record maturity, and multi-chain breadth, and validates out-of-sample
// accuracy via Leave-One-Out Cross-Validation (LOO-CV) against a naive 0.22x TVL baseline.

export interface ProtocolSnapshotEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolSnapshotEntry[];
  watchlist: string[];
}

export interface PeerCurveParams {
  version: string;
  alpha: number;
  beta: number;
  shrinkage_k: number;
  cat_adj_cap: number;
  momentum_pos_weight: number;
  momentum_neg_weight: number;
  momentum_min_pct: number;
  momentum_max_pct: number;
  maturity_base: number;
  maturity_span: number;
  maturity_horizon_days: number;
  fallback_age_days: number;
  chain_step: number;
  max_extra_chains: number;
  baseline_multiple: number;
}

export const MODEL_DEFAULTS = {
  version: 'peer-curve-v2',
  shrinkage_k: 4,
  cat_adj_cap: 1.0,
  momentum_pos_weight: 0.35,
  momentum_neg_weight: 0.65,
  momentum_min_pct: -60,
  momentum_max_pct: 120,
  maturity_base: 0.7,
  maturity_span: 0.3,
  maturity_horizon_days: 1095,
  fallback_age_days: 365,
  chain_step: 0.04,
  max_extra_chains: 4,
  baseline_multiple: 0.22,
} as const;

export interface CategoryCalibration {
  peers: number;
  median_ratio: number;
  log_adjustment: number;
}

export interface ValidationMetrics {
  live_fit_count: number;
  loo_rmsle: number;
  loo_median_fold: number;
  baseline_rmsle: number;
  baseline_median_fold: number;
  error_reduction_pct: number;
}

export interface ActionStep {
  instruction: string;
  expense: string;
  duration: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  est_farm_cost_usd: number;
  model: {
    version: string;
    curve_base_usd: number;
    category_peers: number;
    category_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface DashboardProtocolRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlisted: boolean;
  implied_value_usd: number;
  est_farm_cost_usd: number;
  curve_base_usd: number;
  category_peers: number;
  category_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

export interface LiveTokenEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl_ratio: number;
}

export interface RadarDataset {
  as_of: string;
  source: string;
  floor_usd: number;
  total_universe: number;
  params: PeerCurveParams;
  category_calibration: Record<string, CategoryCalibration>;
  validation: ValidationMetrics;
  watchlist_total: number;
  board_total: number;
  early_total: number;
  live_total: number;
  aggregate_implied_usd: number;
  categories: string[];
  chains: string[];
  rows: DashboardProtocolRow[];
  live: LiveTokenEntry[];
}

export class SnapshotValidationError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SnapshotValidationError';
  }
}

const MS_PER_DAY = 86_400_000;
const MAX_EARLY_ROWS = 160;
const MAX_LIVE_DISPLAY = 40;
const RELEASE_SUFFIX_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_EARLY_CATS = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIX_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_STAKED_RE = /\b(wrapped|staked|staking)\b/i;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : 0.5 * (sorted[mid - 1]! + sorted[mid]!);
}

function roundN(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function computeAgeDays(asOfIso: string, listedAtIso: string | null): number | null {
  if (!listedAtIso) return null;
  const endTs = Date.parse(`${asOfIso}T00:00:00Z`);
  const startTs = Date.parse(`${listedAtIso}T00:00:00Z`);
  if (!Number.isFinite(endTs) || !Number.isFinite(startTs)) return null;
  return Math.max(0, Math.floor((endTs - startTs) / MS_PER_DAY));
}

interface FitPoint {
  x: number;
  y: number;
  cat: string;
  tvl: number;
}

function fitHuberLine(points: FitPoint[]): { alpha: number; beta: number } {
  if (points.length < 2) return { alpha: 0, beta: 0.5 };
  let alpha = 0;
  let beta = 0.5;
  const weights = new Array<number>(points.length).fill(1);

  for (let iter = 0; iter < 15; iter++) {
    let sumW = 0;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < points.length; i++) {
      const w = weights[i]!;
      sumW += w;
      sumX += w * points[i]!.x;
      sumY += w * points[i]!.y;
    }
    const meanX = sumX / sumW;
    const meanY = sumY / sumW;
    let cov = 0;
    let varX = 0;
    for (let i = 0; i < points.length; i++) {
      const dx = points[i]!.x - meanX;
      cov += weights[i]! * dx * (points[i]!.y - meanY);
      varX += weights[i]! * dx * dx;
    }
    beta = varX > 0 ? cov / varX : 0.5;
    alpha = meanY - beta * meanX;

    const absRes = points.map((pt) => Math.abs(pt.y - (alpha + beta * pt.x)));
    const mad = Math.max(0.2, 1.4826 * median(absRes));
    const cutoff = 1.345 * mad;
    for (let i = 0; i < points.length; i++) {
      const r = absRes[i]!;
      weights[i] = r <= cutoff ? 1 : cutoff / r;
    }
  }
  return { alpha, beta };
}

function buildCategoryCalibrations(
  points: FitPoint[],
  alpha: number,
  beta: number,
): Record<string, CategoryCalibration> {
  const byCat = new Map<string, { residuals: number[]; ratios: number[] }>();
  for (const pt of points) {
    let bucket = byCat.get(pt.cat);
    if (!bucket) {
      bucket = { residuals: [], ratios: [] };
      byCat.set(pt.cat, bucket);
    }
    bucket.residuals.push(pt.y - (alpha + beta * pt.x));
    bucket.ratios.push(Math.exp(pt.y) / pt.tvl);
  }
  const out: Record<string, CategoryCalibration> = {};
  for (const cat of [...byCat.keys()].sort()) {
    const b = byCat.get(cat)!;
    const n = b.residuals.length;
    const rawMed = median(b.residuals);
    const bounded = Math.min(MODEL_DEFAULTS.cat_adj_cap, Math.max(-MODEL_DEFAULTS.cat_adj_cap, rawMed));
    const shrunk = (n / (n + MODEL_DEFAULTS.shrinkage_k)) * bounded;
    out[cat] = {
      peers: n,
      median_ratio: roundN(median(b.ratios), 4),
      log_adjustment: roundN(shrunk, 6),
    };
  }
  return out;
}

function runLeaveOneOutValidation(points: FitPoint[]): ValidationMetrics {
  const n = points.length;
  if (n < 5) {
    return {
      live_fit_count: n,
      loo_rmsle: 0,
      loo_median_fold: 1,
      baseline_rmsle: 0,
      baseline_median_fold: 1,
      error_reduction_pct: 0,
    };
  }

  let sqErrModel = 0;
  let sqErrBase = 0;
  const absErrModel: number[] = [];
  const absErrBase: number[] = [];

  for (let i = 0; i < n; i++) {
    const train = points.filter((_, idx) => idx !== i);
    const fit = fitHuberLine(train);
    const catRes = new Map<string, number[]>();
    for (const tr of train) {
      let arr = catRes.get(tr.cat);
      if (!arr) {
        arr = [];
        catRes.set(tr.cat, arr);
      }
      arr.push(tr.y - (fit.alpha + fit.beta * tr.x));
    }
    const target = points[i]!;
    const peers = catRes.get(target.cat) ?? [];
    const adj =
      peers.length > 0
        ? (peers.length / (peers.length + MODEL_DEFAULTS.shrinkage_k)) *
          Math.min(MODEL_DEFAULTS.cat_adj_cap, Math.max(-MODEL_DEFAULTS.cat_adj_cap, median(peers)))
        : 0;
    const predLog = fit.alpha + fit.beta * target.x + adj;
    const baseLog = Math.log(Math.max(1, target.tvl * MODEL_DEFAULTS.baseline_multiple));
    const eModel = Math.abs(target.y - predLog);
    const eBase = Math.abs(target.y - baseLog);
    sqErrModel += eModel * eModel;
    sqErrBase += eBase * eBase;
    absErrModel.push(eModel);
    absErrBase.push(eBase);
  }

  const looRmsle = Math.sqrt(sqErrModel / n);
  const baseRmsle = Math.sqrt(sqErrBase / n);
  const looMedFold = Math.exp(median(absErrModel));
  const baseMedFold = Math.exp(median(absErrBase));
  const reduction = baseMedFold > 1 ? ((baseMedFold - looMedFold) / baseMedFold) * 100 : 0;

  return {
    live_fit_count: n,
    loo_rmsle: roundN(looRmsle, 3),
    loo_median_fold: roundN(looMedFold, 2),
    baseline_rmsle: roundN(baseRmsle, 3),
    baseline_median_fold: roundN(baseMedFold, 2),
    error_reduction_pct: roundN(reduction, 1),
  };
}

export function hasNoRecordedToken(entry: ProtocolSnapshotEntry): boolean {
  return entry.mcap_usd === null && entry.gecko_id === null && entry.symbol === null;
}

export function isCleanEarlyCandidate(entry: ProtocolSnapshotEntry): boolean {
  return (
    hasNoRecordedToken(entry) &&
    !EXCLUDED_EARLY_CATS.has(entry.category ?? '') &&
    !EXCHANGE_PREFIX_RE.test(entry.name) &&
    !WRAPPED_STAKED_RE.test(entry.name) &&
    !RELEASE_SUFFIX_RE.test(entry.name)
  );
}

export function evaluateImpliedValuation(
  entry: ProtocolSnapshotEntry,
  asOfIso: string,
  params: PeerCurveParams,
  calibrations: Record<string, CategoryCalibration>,
): {
  impliedUsd: number;
  curveBaseUsd: number;
  catPeers: number;
  catMult: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  ageDays: number | null;
} {
  const ageDays = computeAgeDays(asOfIso, entry.listed_at);
  const catKey = entry.category ?? 'Uncategorized';
  const cal = calibrations[catKey];
  const catPeers = cal ? cal.peers : 0;
  const logAdj = cal ? cal.log_adjustment : 0;
  const catMult = Math.exp(logAdj);

  const curveBaseUsd = Math.exp(params.alpha + params.beta * Math.log(Math.max(1, entry.tvl_usd)));

  const rawGrowth = typeof entry.change_7d === 'number' && Number.isFinite(entry.change_7d) ? entry.change_7d : 0;
  const growthPct = Math.min(params.momentum_max_pct, Math.max(params.momentum_min_pct, rawGrowth));
  const slope = growthPct >= 0 ? params.momentum_pos_weight : params.momentum_neg_weight;
  const growthMult = 1 + (growthPct / 100) * slope;

  const effectiveAge = ageDays ?? params.fallback_age_days;
  const boundedAge = Math.min(Math.max(effectiveAge, 0), params.maturity_horizon_days);
  const maturityMult = params.maturity_base + (boundedAge / params.maturity_horizon_days) * params.maturity_span;

  const extraChains = Math.min(params.max_extra_chains, Math.max(0, entry.chains.length - 1));
  const chainMult = 1 + extraChains * params.chain_step;

  const impliedUsd = Math.max(1, Math.round(curveBaseUsd * catMult * growthMult * maturityMult * chainMult));
  return {
    impliedUsd,
    curveBaseUsd,
    catPeers,
    catMult,
    growthPct,
    growthMult,
    maturityMult,
    chainMult,
    ageDays,
  };
}

interface ChainGasProfile {
  txUsd: number;
  label: string;
}

function chainGasProfile(chain: string): ChainGasProfile {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { txUsd: 6, label: 'Ethereum L1' };
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos') || c.includes('ton')) {
    return { txUsd: 0.25, label: chain };
  }
  if (
    c.includes('arbitrum') ||
    c.includes('base') ||
    c.includes('optimism') ||
    c.includes('scroll') ||
    c.includes('zksync') ||
    c.includes('linea') ||
    c.includes('starknet')
  ) {
    return { txUsd: 0.6, label: chain };
  }
  return { txUsd: 1.2, label: chain };
}

function commitCapitalUsd(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  if (tvlUsd >= 15_000_000) return 75;
  return 50;
}

function holdDaysForAge(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 90) return 90;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

function categoryActionCopy(entry: ProtocolSnapshotEntry, capitalUsd: number, chain: string): string {
  const cat = (entry.category ?? '').toLowerCase();
  const nm = entry.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral') || cat.includes('money market') || cat.includes('rist')) {
    return `Supply $${capitalUsd} USDC as collateral in ${nm} on ${chain}, borrow 20-30% in a correlated stable asset, and maintain safe health factor.`;
  }
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm') || cat.includes('amm')) {
    return `Deploy $${capitalUsd} into ${nm}'s deepest stable/blue-chip pool on ${chain} and keep the LP receipt un-withdrawn for the full epoch.`;
  }
  if (cat.includes('bridge')) {
    return `Route $${capitalUsd} USDC to ${chain} through ${nm}, perform one destination swap, and leave liquidity active until the end of the window.`;
  }
  if (cat.includes('staking') || cat.includes('restak')) {
    return `Stake $${capitalUsd} of the native/LST asset via ${nm} on ${chain} and keep the liquid receipt token in the same burner wallet.`;
  }
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('leverage')) {
    return `Deposit $${capitalUsd} USDC margin on ${nm} (${chain}), execute low-leverage delta-neutral or hedged trades to build verified volume.`;
  }
  if (cat.includes('prediction') || cat.includes('betting') || cat.includes('market')) {
    return `Fund $${capitalUsd} USDC into ${nm} on ${chain} and place staggered positions across resolved weekly markets to log steady participation.`;
  }
  if (cat.includes('curat') || cat.includes('allocat') || cat.includes('vault')) {
    return `Deposit $${capitalUsd} USDC or WETH into a curated ${nm} vault on ${chain} and stake vault shares in any active points gauge.`;
  }
  if (cat.includes('rwa') || cat.includes('tokenized')) {
    return `Subscribe $${capitalUsd} into ${nm}'s tokenized treasury or yield vault on ${chain} and hold the receipt continuously.`;
  }
  return `Deposit $${capitalUsd} USDC into ${nm}'s primary contract on ${chain} and complete one verifiable on-chain state change.`;
}

function clampStep(step: ActionStep): string {
  let line = `${step.instruction} Cost: ${step.expense}. Time: ${step.duration}.`;
  if (line.length > 600) line = `${line.slice(0, 596)}...`;
  if (line.length < 20) line = `${line} Maintain active position until official TGE snapshot.`;
  return line;
}

export function buildFarmPlan(
  entry: ProtocolSnapshotEntry,
  ageDays: number | null,
): { steps: ActionStep[]; estGasCostUsd: number } {
  const primaryChain = entry.chains.length > 0 ? entry.chains[0]! : 'its primary chain';
  const gasProfile = chainGasProfile(primaryChain);
  const capitalUsd = commitCapitalUsd(entry.tvl_usd);
  const holdDays = holdDaysForAge(ageDays);
  const weeks = Math.max(4, Math.round(holdDays / 7));

  const setupGas = Math.max(1, Math.round(gasProfile.txUsd * 2));
  const weeklyGasTotal = Math.max(2, Math.round(gasProfile.txUsd * weeks));
  const totalGasCost = setupGas + weeklyGasTotal;

  const steps: ActionStep[] = [
    {
      instruction: `Isolate risk in a fresh burner wallet funded with $${capitalUsd} USDC plus gas on ${gasProfile.label}; record keys offline only.`,
      expense: `$${capitalUsd} refundable principal + ~$${Math.max(1, Math.round(gasProfile.txUsd))} transfer gas`,
      duration: '10 minutes',
    },
    {
      instruction: `Cross-check ${entry.name}'s official docs and verified ${primaryChain} contract addresses; revoke stale allowances before interacting.`,
      expense: '$0 (verification)',
      duration: '15 minutes',
    },
    {
      instruction: categoryActionCopy(entry, capitalUsd, primaryChain),
      expense: `$${capitalUsd} deployed + ~$${setupGas} entry/approval gas on ${gasProfile.label}`,
      duration: '15 minutes',
    },
    {
      instruction: `Log one organic transaction weekly (rebalance, compound, or governance vote) across ${weeks} weeks to avoid single-tx sybil filters.`,
      expense: `~$${gasProfile.txUsd.toFixed(2)}/tx (~$${weeklyGasTotal} total over ${weeks} weeks)`,
      duration: `10 min/week for ${holdDays} days`,
    },
    {
      instruction: `Hold capital through the full ${holdDays}-day horizon and track official ${entry.name} epoch/points leaderboards monthly.`,
      expense: `~$${Math.max(1, Math.round(gasProfile.txUsd))} exit gas at unwind`,
      duration: `${holdDays} days total`,
    },
    {
      instruction: `Watch official channels for TGE snapshot or claim announcements; verify claim calldata before signing and reject paid-claim scams.`,
      expense: '$0 monitoring (claim gas only at TGE)',
      duration: '10 minutes per announcement',
    },
    {
      instruction: `Maintain an audit sheet of wallet address, tx hashes, deposit dates, and capital committed for clean unwind or reward verification.`,
      expense: '$0 (tracking)',
      duration: '5 minutes setup',
    },
  ];

  return { steps, estGasCostUsd: totalGasCost };
}

function orderBySlug(a: ProtocolSnapshotEntry, b: ProtocolSnapshotEntry): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarDataset } {
  const liveProtocols = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const fitPoints: FitPoint[] = liveProtocols.map((p) => ({
    x: Math.log(p.tvl_usd),
    y: Math.log(p.mcap_usd!),
    cat: p.category ?? 'Uncategorized',
    tvl: p.tvl_usd,
  }));

  const curve = fitHuberLine(fitPoints);
  const params: PeerCurveParams = {
    version: MODEL_DEFAULTS.version,
    alpha: roundN(curve.alpha, 6),
    beta: roundN(curve.beta, 6),
    shrinkage_k: MODEL_DEFAULTS.shrinkage_k,
    cat_adj_cap: MODEL_DEFAULTS.cat_adj_cap,
    momentum_pos_weight: MODEL_DEFAULTS.momentum_pos_weight,
    momentum_neg_weight: MODEL_DEFAULTS.momentum_neg_weight,
    momentum_min_pct: MODEL_DEFAULTS.momentum_min_pct,
    momentum_max_pct: MODEL_DEFAULTS.momentum_max_pct,
    maturity_base: MODEL_DEFAULTS.maturity_base,
    maturity_span: MODEL_DEFAULTS.maturity_span,
    maturity_horizon_days: MODEL_DEFAULTS.maturity_horizon_days,
    fallback_age_days: MODEL_DEFAULTS.fallback_age_days,
    chain_step: MODEL_DEFAULTS.chain_step,
    max_extra_chains: MODEL_DEFAULTS.max_extra_chains,
    baseline_multiple: MODEL_DEFAULTS.baseline_multiple,
  };

  const categoryCalibration = buildCategoryCalibrations(fitPoints, params.alpha, params.beta);
  const validation = runLeaveOneOutValidation(fitPoints);

  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, ProtocolSnapshotEntry>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) chosen.set(slug, p);
  }

  const earlyCandidates = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isCleanEarlyCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || orderBySlug(a, b))
    .slice(0, MAX_EARLY_ROWS);
  for (const p of earlyCandidates) chosen.set(p.slug, p);

  const scored = [...chosen.values()]
    .map((entry) => ({
      entry,
      ev: evaluateImpliedValuation(entry, snapshot.as_of, params, categoryCalibration),
    }))
    .sort((a, b) => b.ev.impliedUsd - a.ev.impliedUsd || orderBySlug(a.entry, b.entry));

  const board: BoardRow[] = scored.map(({ entry, ev }, idx) => {
    const plan = buildFarmPlan(entry, ev.ageDays);
    return {
      rank: idx + 1,
      slug: entry.slug,
      name: entry.name,
      category: entry.category,
      chains: entry.chains,
      tvl_usd: entry.tvl_usd,
      change_7d: entry.change_7d,
      mcap_usd: entry.mcap_usd,
      listed_at: entry.listed_at,
      gecko_id: entry.gecko_id,
      symbol: entry.symbol,
      token_status: 'pre-token' as const,
      age_days: ev.ageDays,
      implied_value_usd: ev.impliedUsd,
      est_farm_cost_usd: plan.estGasCostUsd,
      model: {
        version: params.version,
        curve_base_usd: Math.round(ev.curveBaseUsd),
        category_peers: ev.catPeers,
        category_multiplier: roundN(ev.catMult, 4),
        growth_pct: ev.growthPct,
        growth_multiplier: roundN(ev.growthMult, 4),
        maturity_multiplier: roundN(ev.maturityMult, 4),
        chain_multiplier: roundN(ev.chainMult, 4),
        age_days: ev.ageDays,
      },
      farm_steps: plan.steps.map(clampStep),
    };
  });

  const liveRows: LiveTokenEntry[] = liveProtocols
    .slice()
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, MAX_LIVE_DISPLAY)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl_ratio: roundN(p.mcap_usd! / p.tvl_usd, 3),
    }));

  const watchSet = new Set(snapshot.watchlist);
  const earlyTotal = board.filter((r) => !watchSet.has(r.slug)).length;
  const categories = [...new Set(board.map((r) => r.category).filter((c): c is string => c !== null))].sort();
  const chains = [...new Set(board.flatMap((r) => r.chains))].sort();
  const aggregateImplied = board.reduce((acc, r) => acc + r.implied_value_usd, 0);

  const radar: RadarDataset = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    total_universe: snapshot.protocols.length,
    params,
    category_calibration: categoryCalibration,
    validation,
    watchlist_total: snapshot.watchlist.length,
    board_total: board.length,
    early_total: earlyTotal,
    live_total: liveRows.length,
    aggregate_implied_usd: aggregateImplied,
    categories,
    chains,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlisted: watchSet.has(r.slug),
      implied_value_usd: r.implied_value_usd,
      est_farm_cost_usd: r.est_farm_cost_usd,
      curve_base_usd: r.model.curve_base_usd,
      category_peers: r.model.category_peers,
      category_multiplier: r.model.category_multiplier,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      chain_multiplier: r.model.chain_multiplier,
    })),
    live: liveRows,
  };

  return { board, radar };
}

export function parseSnapshot(jsonText: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new SnapshotValidationError('snapshot.json is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotValidationError('snapshot.json root must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.as_of)) {
    throw new SnapshotValidationError('snapshot.json missing YYYY-MM-DD as_of');
  }
  if (typeof obj.source !== 'string') throw new SnapshotValidationError('snapshot.json missing source');
  if (typeof obj.floor_usd !== 'number' || !Number.isSafeInteger(obj.floor_usd) || obj.floor_usd <= 0) {
    throw new SnapshotValidationError('snapshot.json missing positive integer floor_usd');
  }
  if (!Array.isArray(obj.protocols)) throw new SnapshotValidationError('snapshot.json missing protocols array');
  if (!Array.isArray(obj.watchlist) || obj.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotValidationError('snapshot.json missing string watchlist');
  }

  const protocols: ProtocolSnapshotEntry[] = obj.protocols.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new SnapshotValidationError(`protocol[${idx}] is not an object`);
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.slug !== 'string' || typeof rec.name !== 'string' || typeof rec.tvl_usd !== 'number' || !Number.isFinite(rec.tvl_usd)) {
      throw new SnapshotValidationError(`protocol[${idx}] missing slug, name, or finite tvl_usd`);
    }
    return {
      slug: rec.slug,
      name: rec.name,
      category: typeof rec.category === 'string' ? rec.category : null,
      chains: Array.isArray(rec.chains) ? rec.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: rec.tvl_usd,
      change_7d: typeof rec.change_7d === 'number' && Number.isFinite(rec.change_7d) ? rec.change_7d : null,
      mcap_usd: typeof rec.mcap_usd === 'number' && Number.isFinite(rec.mcap_usd) ? rec.mcap_usd : null,
      listed_at: typeof rec.listed_at === 'string' ? rec.listed_at : null,
      gecko_id: typeof rec.gecko_id === 'string' ? rec.gecko_id : null,
      symbol: typeof rec.symbol === 'string' ? rec.symbol : null,
    };
  });

  return {
    as_of: obj.as_of,
    source: obj.source,
    floor_usd: obj.floor_usd,
    protocols,
    watchlist: obj.watchlist as string[],
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const presentSlugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !presentSlugs.has(s));
  if (missing.length > 0) {
    return `missing ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  }
  const sortedRanks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < sortedRanks.length; i++) {
    if (sortedRanks[i] !== i + 1) return `expected rank ${i + 1}, got ${sortedRanks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `rank order violation at row ${i + 1}`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `degenerate board: all ${board.length} rows share implied value $${board[0]!.implied_value_usd}`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const s of row.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${row.slug} has step length ${len}`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `${row.slug} has invalid implied_value_usd ${row.implied_value_usd}`;
    }
  }
  return null;
}

export function dataScript(radar: RadarDataset): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
