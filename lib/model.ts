// Deterministic pre-token protocol scoring engine (radar-2) for Token Radar.
// Computes implied launch valuation strictly from sealed snapshot metrics:
// TVL base multiple (0.22), asymmetric 7-day momentum multiplier, and age maturity curve.

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

export interface RadarModelConfig {
  version: string;
  base_tvl_multiple: number;
  momentum_pos_weight: number;
  momentum_neg_weight: number;
  momentum_min_pct: number;
  momentum_max_pct: number;
  maturity_base: number;
  maturity_span: number;
  maturity_horizon_days: number;
  fallback_age_days: number;
}

export const RADAR2_CONFIG: RadarModelConfig = {
  version: 'radar-2',
  base_tvl_multiple: 0.22,
  momentum_pos_weight: 0.5,
  momentum_neg_weight: 0.9,
  momentum_min_pct: -60,
  momentum_max_pct: 120,
  maturity_base: 0.55,
  maturity_span: 0.45,
  maturity_horizon_days: 1095,
  fallback_age_days: 365,
};

export const MAX_EARLY_PROTOCOLS = 160;
export const MAX_LIVE_PROTOCOLS = 24;

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
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
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
  growth_multiplier: number;
  maturity_multiplier: number;
}

export interface LiveTokenEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarDataset {
  as_of: string;
  source: string;
  floor_usd: number;
  total_universe: number;
  config: RadarModelConfig;
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
const RELEASE_SUFFIX_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

function computeAgeInDays(asOfIso: string, listedAtIso: string | null): number | null {
  if (!listedAtIso) return null;
  const endTs = Date.parse(`${asOfIso}T00:00:00Z`);
  const startTs = Date.parse(`${listedAtIso}T00:00:00Z`);
  if (!Number.isFinite(endTs) || !Number.isFinite(startTs)) return null;
  return Math.max(0, Math.floor((endTs - startTs) / MS_PER_DAY));
}

export function evaluateImpliedValuation(
  entry: ProtocolSnapshotEntry,
  asOfIso: string,
  cfg: RadarModelConfig = RADAR2_CONFIG,
): {
  impliedUsd: number;
  clampedGrowthPct: number;
  momentumMult: number;
  maturityMult: number;
  ageDays: number | null;
} {
  const ageDays = computeAgeInDays(asOfIso, entry.listed_at);
  const rawPct = typeof entry.change_7d === 'number' && Number.isFinite(entry.change_7d) ? entry.change_7d : 0;
  const clampedGrowthPct = Math.min(cfg.momentum_max_pct, Math.max(cfg.momentum_min_pct, rawPct));
  const slope = clampedGrowthPct >= 0 ? cfg.momentum_pos_weight : cfg.momentum_neg_weight;
  const momentumMult = 1 + (clampedGrowthPct / 100) * slope;
  const effectiveAge = ageDays ?? cfg.fallback_age_days;
  const boundedAge = Math.min(Math.max(effectiveAge, 0), cfg.maturity_horizon_days);
  const maturityMult = cfg.maturity_base + (boundedAge / cfg.maturity_horizon_days) * cfg.maturity_span;
  const baseUsd = entry.tvl_usd * cfg.base_tvl_multiple;
  const impliedUsd = Math.max(1, Math.round(baseUsd * momentumMult * maturityMult));
  return { impliedUsd, clampedGrowthPct, momentumMult, maturityMult, ageDays };
}

export function hasNoRecordedToken(entry: ProtocolSnapshotEntry): boolean {
  return entry.mcap_usd === null && entry.gecko_id === null && entry.symbol === null;
}

export function isEligibleEarlyProtocol(entry: ProtocolSnapshotEntry): boolean {
  return hasNoRecordedToken(entry) && entry.category !== 'CEX' && !RELEASE_SUFFIX_RE.test(entry.name);
}

function roundFour(val: number): number {
  return Math.round(val * 10_000) / 10_000;
}

function orderBySlug(left: ProtocolSnapshotEntry, right: ProtocolSnapshotEntry): number {
  return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
}

function determineCommitUsd(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  if (tvlUsd >= 15_000_000) return 75;
  return 50;
}

function determineHoldWindow(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 90) return 90;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

function primaryChainName(entry: ProtocolSnapshotEntry): string {
  return entry.chains.length > 0 ? entry.chains[0]! : 'its primary network';
}

function categoryCoreAction(entry: ProtocolSnapshotEntry, commitUsd: number, chain: string): string {
  const cat = (entry.category ?? '').toLowerCase();
  const label = entry.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral') || cat.includes('money market') || cat.includes('rist')) {
    return `Deposit $${commitUsd} USDC as collateral in ${label} on ${chain}, draw a minimal borrow position, and keep healthy collateralization.`;
  }
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm') || cat.includes('amm')) {
    return `Add $${commitUsd} across a balanced stable liquidity pool on ${label} (${chain}) and retain the LP position receipt.`;
  }
  if (cat.includes('bridge')) {
    return `Transfer $${commitUsd} USDC into ${chain} via ${label}, keep capital active on the destination chain, and bridge back after the window.`;
  }
  if (cat.includes('staking') || cat.includes('restak') || cat.includes('liquid staking')) {
    return `Stake $${commitUsd} of native gas or LST collateral through ${label} on ${chain} and retain the staked token in the same wallet.`;
  }
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('leverage')) {
    return `Post $${commitUsd} USDC margin on ${label} (${chain}), open one low-leverage position, and maintain active open interest.`;
  }
  if (cat.includes('prediction') || cat.includes('betting') || cat.includes('market')) {
    return `Allocate $${commitUsd} USDC to ${label} on ${chain} and take one measured market position with a defined settlement date.`;
  }
  if (cat.includes('curat') || cat.includes('allocat') || cat.includes('vault') || cat.includes('restaked')) {
    return `Allocate $${commitUsd} in USDC or ETH-pegged assets into a curated ${label} vault on ${chain} and keep vault shares staked.`;
  }
  if (cat.includes('stable')) {
    return `Mint or supply $${commitUsd} of ${label}'s stable asset on ${chain} and route it into the protocol's native savings module.`;
  }
  if (cat.includes('rwa') || cat.includes('tokenized')) {
    return `Subscribe $${commitUsd} into ${label}'s tokenized yield instrument on ${chain} and hold the receipt continuously.`;
  }
  if (cat.includes('insurance') || cat.includes('risk')) {
    return `Purchase $${commitUsd} of protocol coverage through ${label} on ${chain} and maintain the policy through maturity.`;
  }
  return `Deploy $${commitUsd} USDC into ${label}'s core smart contract on ${chain} and record at least one qualifying interaction.`;
}

function formatStepLine(step: ActionStep): string {
  let line = `${step.instruction} Cost: ${step.expense}. Time: ${step.duration}.`;
  if (line.length > 600) line = `${line.slice(0, 596)}...`;
  if (line.length < 20) line = `${line} Maintain the position and monitor official announcements.`;
  return line;
}

export function generateFarmPlan(entry: ProtocolSnapshotEntry, ageDays: number | null): ActionStep[] {
  const chain = primaryChainName(entry);
  const commitUsd = determineCommitUsd(entry.tvl_usd);
  const holdDays = determineHoldWindow(ageDays);
  const coreInstruction = categoryCoreAction(entry, commitUsd, chain);
  const initialGas = commitUsd >= 150 ? '~$8' : '~$4';
  const recurringGas = Math.max(8, 2 * Math.round(holdDays / 7));

  return [
    {
      instruction: `Create a dedicated burner wallet isolated from main holdings, fund it with $${commitUsd} USDC plus gas on ${chain}, and back up keys offline.`,
      expense: `$${commitUsd} principal + initial funding gas`,
      duration: '10 minutes',
    },
    {
      instruction: `Verify ${entry.name}'s official documentation and contract addresses on ${chain} directly before signing any approval to avoid phishing links.`,
      expense: '$0 (verification only)',
      duration: '15 minutes',
    },
    {
      instruction: coreInstruction,
      expense: `$${commitUsd} committed capital + ${initialGas} gas`,
      duration: '15 minutes',
    },
    {
      instruction: `Execute one organic weekly transaction (rebalance, compound, borrow/repay, or governance action) so activity spans multiple epochs.`,
      expense: `~$2/week gas (~$${recurringGas} total)`,
      duration: `10 min/week over ${holdDays} days`,
    },
    {
      instruction: `Keep capital deployed for the entire ${holdDays}-day qualifying horizon and review ${entry.name}'s official points or epoch tracker monthly.`,
      expense: `$${commitUsd} remains deployed (withdraw gas only at exit)`,
      duration: `${holdDays} days total`,
    },
    {
      instruction: `Monitor snapshot announcements and TGE claim portals via verified channels only; never pay upfront claim fees or expose seed phrases.`,
      expense: '$0 monitoring (gas only upon valid claim)',
      duration: '10 minutes per milestone',
    },
    {
      instruction: `Archive wallet address, tx hashes, entry/exit timestamps, and position size in a portfolio ledger for points verification or clean unwind.`,
      expense: '$0 (record keeping)',
      duration: '5 minutes setup',
    },
  ];
}

export function buildBoard(snapshot: Snapshot, cfg: RadarModelConfig = RADAR2_CONFIG): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const selected = new Map<string, ProtocolSnapshotEntry>();

  for (const slug of snapshot.watchlist) {
    const found = bySlug.get(slug);
    if (found) selected.set(slug, found);
  }

  const earlyPicks = snapshot.protocols
    .filter((p) => !selected.has(p.slug) && isEligibleEarlyProtocol(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || orderBySlug(a, b))
    .slice(0, MAX_EARLY_PROTOCOLS);

  for (const pick of earlyPicks) selected.set(pick.slug, pick);

  const ranked = [...selected.values()]
    .map((entry) => ({ entry, val: evaluateImpliedValuation(entry, snapshot.as_of, cfg) }))
    .sort((a, b) => b.val.impliedUsd - a.val.impliedUsd || orderBySlug(a.entry, b.entry));

  return ranked.map(({ entry, val }, idx) => ({
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
    age_days: val.ageDays,
    implied_value_usd: val.impliedUsd,
    model: {
      base_multiple: cfg.base_tvl_multiple,
      growth_pct: val.clampedGrowthPct,
      growth_multiplier: roundFour(val.momentumMult),
      maturity_multiplier: roundFour(val.maturityMult),
      age_days: val.ageDays,
    },
    farm_steps: generateFarmPlan(entry, val.ageDays).map(formatStepLine),
  }));
}

export function extractLiveTokens(snapshot: Snapshot): LiveTokenEntry[] {
  return snapshot.protocols
    .filter((p) => !hasNoRecordedToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, MAX_LIVE_PROTOCOLS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function buildRadar(snapshot: Snapshot, cfg: RadarModelConfig = RADAR2_CONFIG): { board: BoardRow[]; radar: RadarDataset } {
  const board = buildBoard(snapshot, cfg);
  const live = extractLiveTokens(snapshot);
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
    config: cfg,
    watchlist_total: snapshot.watchlist.length,
    board_total: board.length,
    early_total: earlyTotal,
    live_total: live.length,
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
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
    })),
    live,
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
