// Token Radar v2 renderer: empirical peer-curve valuation, inline SVG charts,
// Leave-One-Out validation panel, chain-aware farm plans, and in-page recomputation.
(() => {
  'use strict';

  const dataset = window.RADAR;
  if (!dataset) return;

  const stage = document.getElementById('main-stage');
  const ui = {
    tab: 'board',
    query: '',
    category: 'all',
    chain: 'all',
    scope: 'all',
    sortKey: 'implied',
    sortDir: -1,
    activeSlug: null,
  };

  const currencyFmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  const formatUsd = (amount) => {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) return 'n/a';
    if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`;
    if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
    if (Math.abs(amount) >= 1e3) return `$${Math.round(amount / 1e3)}K`;
    return currencyFmt.format(amount);
  };

  const formatDelta = (pct) => {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'n/a';
    return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  };

  const formatDuration = (days) => {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return `${(days / 365).toFixed(1)}y`;
    return `${Math.max(0, Math.round(days))}d`;
  };

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  const SVG_NS = document.getElementById('svg-ns').namespaceURI;
  function svgEl(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== null && v !== undefined) node.setAttribute(k, String(v));
      }
    }
    for (const child of children.flat()) {
      if (child) node.appendChild(child);
    }
    return node;
  }

  // Exact browser mirror of evaluateImpliedValuation in lib/model.ts.
  function recomputeValuation(row) {
    const p = dataset.params;
    const cal = dataset.category_calibration[row.category || 'Uncategorized'];
    const logAdj = cal ? cal.log_adjustment : 0;
    const catMult = Math.exp(logAdj);
    const curveBaseUsd = Math.exp(p.alpha + p.beta * Math.log(Math.max(1, row.tvl_usd)));

    const rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const growthPct = Math.min(p.momentum_max_pct, Math.max(p.momentum_min_pct, rawGrowth));
    const slope = growthPct >= 0 ? p.momentum_pos_weight : p.momentum_neg_weight;
    const growthMult = 1 + (growthPct / 100) * slope;

    const effectiveAge = row.age_days === null || row.age_days === undefined ? p.fallback_age_days : row.age_days;
    const boundedAge = Math.min(Math.max(effectiveAge, 0), p.maturity_horizon_days);
    const maturityMult = p.maturity_base + (boundedAge / p.maturity_horizon_days) * p.maturity_span;

    const extraChains = Math.min(p.max_extra_chains, Math.max(0, row.chains.length - 1));
    const chainMult = 1 + extraChains * p.chain_step;

    return {
      curveBaseUsd,
      catPeers: cal ? cal.peers : 0,
      catMult,
      growthPct,
      growthMult,
      maturityMult,
      chainMult,
      impliedUsd: Math.max(1, Math.round(curveBaseUsd * catMult * growthMult * maturityMult * chainMult)),
    };
  }

  function chainGasProfile(chain) {
    const c = (chain || '').toLowerCase();
    if (c === 'ethereum') return { txUsd: 6, label: 'Ethereum L1' };
    if (/solana|sui|aptos|ton/.test(c)) return { txUsd: 0.25, label: chain };
    if (/arbitrum|base|optimism|scroll|zksync|linea|starknet/.test(c)) return { txUsd: 0.6, label: chain };
    return { txUsd: 1.2, label: chain };
  }

  function capitalTier(tvlUsd) {
    if (tvlUsd >= 1e9) return 250;
    if (tvlUsd >= 250e6) return 150;
    if (tvlUsd >= 50e6) return 100;
    if (tvlUsd >= 15e6) return 75;
    return 50;
  }

  function holdWindow(ageDays) {
    if (ageDays === null) return 45;
    if (ageDays < 90) return 90;
    if (ageDays < 180) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }

  function coreFarmAction(row, capitalUsd, chain) {
    const cat = (row.category || '').toLowerCase();
    const nm = row.name;
    if (/lend|cdp|collateral|money market|rist/.test(cat)) {
      return `Supply $${capitalUsd} USDC as collateral in ${nm} on ${chain}, borrow 20-30% in a correlated stable asset, and maintain safe health factor.`;
    }
    if (/dex|yield|leveraged farm|amm/.test(cat)) {
      return `Deploy $${capitalUsd} into ${nm}'s deepest stable/blue-chip pool on ${chain} and keep the LP receipt un-withdrawn for the full epoch.`;
    }
    if (/bridge/.test(cat)) {
      return `Route $${capitalUsd} USDC to ${chain} through ${nm}, perform one destination swap, and leave liquidity active until the end of the window.`;
    }
    if (/staking|restak/.test(cat)) {
      return `Stake $${capitalUsd} of the native/LST asset via ${nm} on ${chain} and keep the liquid receipt token in the same burner wallet.`;
    }
    if (/perpetual|derivative|leverage/.test(cat)) {
      return `Deposit $${capitalUsd} USDC margin on ${nm} (${chain}), execute low-leverage delta-neutral or hedged trades to build verified volume.`;
    }
    if (/prediction|betting|market/.test(cat)) {
      return `Fund $${capitalUsd} USDC into ${nm} on ${chain} and place staggered positions across resolved weekly markets to log steady participation.`;
    }
    if (/curat|allocat|vault/.test(cat)) {
      return `Deposit $${capitalUsd} USDC or WETH into a curated ${nm} vault on ${chain} and stake vault shares in any active points gauge.`;
    }
    if (/rwa|tokenized/.test(cat)) {
      return `Subscribe $${capitalUsd} into ${nm}'s tokenized treasury or yield vault on ${chain} and hold the receipt continuously.`;
    }
    return `Deposit $${capitalUsd} USDC into ${nm}'s primary contract on ${chain} and complete one verifiable on-chain state change.`;
  }

  function buildProtocolPlan(row) {
    const primaryChain = row.chains && row.chains.length ? row.chains[0] : 'its primary chain';
    const gas = chainGasProfile(primaryChain);
    const capitalUsd = capitalTier(row.tvl_usd);
    const holdDays = holdWindow(row.age_days);
    const weeks = Math.max(4, Math.round(holdDays / 7));
    const setupGas = Math.max(1, Math.round(gas.txUsd * 2));
    const weeklyGas = Math.max(2, Math.round(gas.txUsd * weeks));

    return {
      capitalUsd,
      holdDays,
      totalGasUsd: setupGas + weeklyGas,
      steps: [
        {
          instruction: `Isolate risk in a fresh burner wallet funded with $${capitalUsd} USDC plus gas on ${gas.label}; record keys offline only.`,
          expense: `$${capitalUsd} refundable principal + ~$${Math.max(1, Math.round(gas.txUsd))} transfer gas`,
          duration: '10 minutes',
        },
        {
          instruction: `Cross-check ${row.name}'s official docs and verified ${primaryChain} contract addresses; revoke stale allowances before interacting.`,
          expense: '$0 (verification)',
          duration: '15 minutes',
        },
        {
          instruction: coreFarmAction(row, capitalUsd, primaryChain),
          expense: `$${capitalUsd} deployed + ~$${setupGas} entry/approval gas on ${gas.label}`,
          duration: '15 minutes',
        },
        {
          instruction: `Log one organic transaction weekly (rebalance, compound, or governance vote) across ${weeks} weeks to avoid single-tx sybil filters.`,
          expense: `~$${gas.txUsd.toFixed(2)}/tx (~$${weeklyGas} total over ${weeks} weeks)`,
          duration: `10 min/week for ${holdDays} days`,
        },
        {
          instruction: `Hold capital through the full ${holdDays}-day horizon and track official ${row.name} epoch/points leaderboards monthly.`,
          expense: `~$${Math.max(1, Math.round(gas.txUsd))} exit gas at unwind`,
          duration: `${holdDays} days total`,
        },
        {
          instruction: 'Watch official channels for TGE snapshot or claim announcements; verify claim calldata before signing and reject paid-claim scams.',
          expense: '$0 monitoring (claim gas only at TGE)',
          duration: '10 minutes per announcement',
        },
        {
          instruction: 'Maintain an audit sheet of wallet address, tx hashes, deposit dates, and capital committed for clean unwind or reward verification.',
          expense: '$0 (tracking)',
          duration: '5 minutes setup',
        },
      ],
    };
  }

  function populateHeaderPills() {
    const dateEl = document.getElementById('badge-date');
    dateEl.textContent = '';
    dateEl.appendChild(h('span', null, 'snapshot ', h('strong', { text: dataset.as_of })));

    const modelEl = document.getElementById('badge-model');
    modelEl.textContent = '';
    modelEl.appendChild(h('span', null, 'model ', h('strong', { text: dataset.params.version })));

    const fitEl = document.getElementById('badge-fit');
    fitEl.textContent = '';
    fitEl.appendChild(h('span', null, 'elasticity ', h('strong', { text: `TVL^${dataset.params.beta.toFixed(2)}` })));
  }

  function renderKpis() {
    const grid = document.getElementById('kpi-grid');
    grid.textContent = '';
    const watchCount = dataset.rows.filter((r) => r.watchlisted).length;
    const earlyCount = dataset.board_total - watchCount;
    const positiveCount = dataset.rows.filter((r) => r.change_7d !== null && r.change_7d > 0).length;
    const v = dataset.validation;

    const cards = [
      {
        featured: true,
        k: 'Aggregate Implied Value',
        v: formatUsd(dataset.aggregate_implied_usd),
        d: `${dataset.board_total} clean pre-token protocols`,
      },
      {
        k: 'Watchlist & Early Finds',
        v: `${watchCount}/${dataset.watchlist_total} + ${earlyCount}`,
        d: `100% floor covered, ${earlyCount} below ${formatUsd(dataset.floor_usd)}`,
      },
      {
        k: 'Peer Size Elasticity',
        v: `TVL^${dataset.params.beta.toFixed(2)}`,
        d: `Huber IRLS fit on ${v.live_fit_count} live tokens`,
      },
      {
        k: 'LOO Out-of-Sample Error',
        v: `${v.loo_median_fold}x`,
        d: `vs ${v.baseline_median_fold}x flat 0.22x (-${v.error_reduction_pct}%)`,
      },
      {
        k: '7d Positive Momentum',
        v: String(positiveCount),
        d: 'expanding TVL over last 7 days',
      },
    ];

    for (const c of cards) {
      grid.appendChild(
        h(
          'div',
          { class: `kpi-card${c.featured ? ' featured' : ''}` },
          h('div', { class: 'kpi-label', text: c.k }),
          h('div', { class: 'kpi-val', text: c.v }),
          h('div', { class: 'kpi-sub', text: c.d }),
        ),
      );
    }
  }

  function renderCharts() {
    const host = document.getElementById('chart-grid');
    host.textContent = '';

    // Left: Log-log TVL vs Valuation curve + live comps + pre-token picks
    const W = 560;
    const H = 158;
    const pad = { l: 48, r: 16, t: 12, b: 24 };
    const minX = Math.log(4e6);
    const maxX = Math.log(4e9);
    const minY = Math.log(4e5);
    const maxY = Math.log(8e9);
    const sx = (tvl) => pad.l + ((Math.min(maxX, Math.max(minX, Math.log(Math.max(1, tvl)))) - minX) / (maxX - minX)) * (W - pad.l - pad.r);
    const sy = (val) => H - pad.b - ((Math.min(maxY, Math.max(minY, Math.log(Math.max(1, val)))) - minY) / (maxY - minY)) * (H - pad.t - pad.b);

    const scatterSvg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': 'TVL vs implied valuation log scatter' });

    for (const tickTvl of [5e6, 5e7, 5e8, 3e9]) {
      const x = sx(tickTvl);
      scatterSvg.appendChild(svgEl('line', { x1: x, y1: pad.t, x2: x, y2: H - pad.b, stroke: '#1d2d4a', 'stroke-dasharray': '2,3' }));
      scatterSvg.appendChild(svgEl('text', { x, y: H - 7, 'text-anchor': 'middle', class: 'axis-lbl' }, document.createTextNode(formatUsd(tickTvl).replace(/\.0+([BMK])$/, '$1'))));
    }
    for (const tickVal of [1e6, 2e7, 5e8]) {
      const y = sy(tickVal);
      scatterSvg.appendChild(svgEl('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: '#1d2d4a', 'stroke-dasharray': '2,3' }));
      scatterSvg.appendChild(svgEl('text', { x: pad.l - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-lbl' }, document.createTextNode(formatUsd(tickVal).replace(/\.0+([BMK])$/, '$1'))));
    }

    // Fitted Huber curve line
    const y0 = Math.exp(dataset.params.alpha + dataset.params.beta * minX);
    const y1 = Math.exp(dataset.params.alpha + dataset.params.beta * maxX);
    scatterSvg.appendChild(svgEl('line', { x1: sx(Math.exp(minX)), y1: sy(y0), x2: sx(Math.exp(maxX)), y2: sy(y1), stroke: '#99bbff', 'stroke-width': 1.8, 'stroke-dasharray': '5,3', opacity: 0.9 }));

    for (const lp of dataset.live) {
      scatterSvg.appendChild(svgEl('circle', { cx: sx(lp.tvl_usd).toFixed(1), cy: sy(lp.mcap_usd).toFixed(1), r: 2.6, fill: '#6d84a3', opacity: 0.55 }));
    }
    for (const r of dataset.rows.slice(0, 90)) {
      scatterSvg.appendChild(
        svgEl('circle', {
          cx: sx(r.tvl_usd).toFixed(1),
          cy: sy(r.implied_value_usd).toFixed(1),
          r: r.watchlisted ? 3.2 : 2.5,
          fill: r.watchlisted ? '#f8c555' : '#34e0ae',
          opacity: r.watchlisted ? 0.92 : 0.78,
        }),
      );
    }

    const leftCard = h(
      'div',
      { class: 'chart-card' },
      h(
        'div',
        { class: 'chart-head' },
        h('h3', { text: 'Log-Log Calibration: TVL vs Valuation' }),
        h(
          'div',
          { class: 'chart-legend' },
          h('span', { class: 'leg-item' }, h('span', { class: 'leg-dot', style: 'background:#6d84a3' }), 'Live'),
          h('span', { class: 'leg-item' }, h('span', { class: 'leg-dot', style: 'background:#f8c555' }), 'Watch'),
          h('span', { class: 'leg-item' }, h('span', { class: 'leg-dot', style: 'background:#34e0ae' }), 'Early'),
        ),
      ),
      scatterSvg,
    );

    // Right: Top 6 categories by implied launch value
    const catTotals = new Map();
    for (const r of dataset.rows) {
      const cat = r.category || 'Other';
      const cur = catTotals.get(cat) || { cat, watch: 0, early: 0, total: 0 };
      if (r.watchlisted) cur.watch += r.implied_value_usd;
      else cur.early += r.implied_value_usd;
      cur.total += r.implied_value_usd;
      catTotals.set(cat, cur);
    }
    const topCats = [...catTotals.values()].sort((a, b) => b.total - a.total).slice(0, 6);
    const maxCat = Math.max(1, topCats[0] ? topCats[0].total : 1);
    const BW = 490;
    const barSvg = svgEl('svg', { viewBox: `0 0 ${BW} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': 'Top categories by implied launch value' });

    topCats.forEach((c, idx) => {
      const y = 8 + idx * 25;
      const barW = 240;
      const xStart = 165;
      const wWatch = (c.watch / maxCat) * barW;
      const wEarly = (c.early / maxCat) * barW;
      const label = c.cat.length > 22 ? `${c.cat.slice(0, 21)}\u2026` : c.cat;
      barSvg.appendChild(svgEl('text', { x: xStart - 8, y: y + 12, 'text-anchor': 'end', class: 'bar-lbl' }, document.createTextNode(label)));
      barSvg.appendChild(svgEl('rect', { x: xStart, y: y + 2, width: barW, height: 12, rx: 3, fill: '#172540' }));
      if (wWatch > 0.5) barSvg.appendChild(svgEl('rect', { x: xStart, y: y + 2, width: wWatch.toFixed(1), height: 12, rx: 3, fill: '#f8c555' }));
      if (wEarly > 0.5) barSvg.appendChild(svgEl('rect', { x: (xStart + wWatch).toFixed(1), y: y + 2, width: wEarly.toFixed(1), height: 12, rx: 3, fill: '#34e0ae' }));
      const cal = dataset.category_calibration[c.cat];
      const peerNote = cal ? ` (${cal.peers}p)` : '';
      barSvg.appendChild(svgEl('text', { x: xStart + barW + 8, y: y + 12, class: 'bar-val' }, document.createTextNode(`${formatUsd(c.total)}${peerNote}`)));
    });

    const rightCard = h(
      'div',
      { class: 'chart-card' },
      h(
        'div',
        { class: 'chart-head' },
        h('h3', { text: 'Top Categories by Implied Value' }),
        h('div', { class: 'chart-legend' }, h('span', { text: 'Watchlist + Early (peers)' })),
      ),
      barSvg,
    );

    host.append(leftCard, rightCard);
  }

  function filteredRows() {
    const needle = ui.query;
    return dataset.rows.filter((r) => {
      if (ui.category !== 'all' && r.category !== ui.category) return false;
      if (ui.chain !== 'all' && !r.chains.includes(ui.chain)) return false;
      if (ui.scope === 'watch' && !r.watchlisted) return false;
      if (ui.scope === 'early' && r.watchlisted) return false;
      if (ui.scope === 'growing' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (needle) {
        const hay = `${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }

  function renderFilterBar() {
    const bar = document.getElementById('filter-bar');
    bar.textContent = '';

    const search = h('input', {
      type: 'search',
      class: 'search-input',
      placeholder: 'Filter protocol, category, or chain\u2026',
      value: ui.query,
      oninput: (e) => {
        ui.query = e.target.value.toLowerCase();
        renderBoardView();
      },
    });

    const catSelect = h(
      'select',
      {
        class: 'filter-select',
        'aria-label': 'Filter by category',
        onchange: (e) => {
          ui.category = e.target.value;
          renderBoardView();
        },
      },
      h('option', { value: 'all', text: 'All categories' }),
      dataset.categories.map((c) => h('option', { value: c, text: c, selected: ui.category === c ? '' : null })),
    );

    const chainSelect = h(
      'select',
      {
        class: 'filter-select',
        'aria-label': 'Filter by chain',
        onchange: (e) => {
          ui.chain = e.target.value;
          renderBoardView();
        },
      },
      h('option', { value: 'all', text: 'All chains' }),
      dataset.chains.slice(0, 45).map((c) => h('option', { value: c, text: c, selected: ui.chain === c ? '' : null })),
    );

    const scopes = [
      { id: 'all', text: 'All' },
      { id: 'watch', text: 'Watchlist' },
      { id: 'early', text: 'Early Finds' },
      { id: 'growing', text: 'Growing 7d' },
    ];

    const scopeBtns = scopes.map((s) =>
      h('button', {
        type: 'button',
        class: `scope-btn${ui.scope === s.id ? ' active' : ''}`,
        text: s.text,
        onclick: () => {
          ui.scope = s.id;
          renderFilterBar();
          renderBoardView();
        },
      }),
    );

    bar.append(search, catSelect, chainSelect, ...scopeBtns);
    bar.appendChild(h('span', { class: 'count-note', id: 'visible-count', text: `${filteredRows().length} / ${dataset.board_total} rows` }));
  }

  const TABLE_COLS = [
    { id: 'rank', label: 'Rank' },
    { id: 'name', label: 'Protocol' },
    { id: 'category', label: 'Category', cls: 'hide-mobile' },
    { id: 'tvl', label: 'TVL' },
    { id: 'chg', label: '7d Delta' },
    { id: 'age', label: 'Age', cls: 'hide-mobile' },
    { id: 'gas', label: 'Est. Gas', cls: 'hide-mobile' },
    { id: 'implied', label: 'Implied Value' },
  ];

  function sortedRows(list) {
    const dir = ui.sortDir;
    const key = ui.sortKey;
    const extract = (r) => {
      if (key === 'rank') return r.rank;
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'category') return (r.category || '').toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'chg') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'gas') return r.est_farm_cost_usd;
      return r.implied_value_usd;
    };
    return list.slice().sort((a, b) => {
      const va = extract(a);
      const vb = extract(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
  }

  function renderBoardView() {
    const rows = sortedRows(filteredRows());
    const topImplied = dataset.rows.reduce((m, r) => Math.max(m, r.implied_value_usd), 1);
    stage.textContent = '';

    const headers = TABLE_COLS.map((col) => {
      const active = ui.sortKey === col.id;
      const arrow = active ? (ui.sortDir === -1 ? ' \u25bc' : ' \u25b2') : '';
      return h('th', {
        scope: 'col',
        class: `sortable${col.cls ? ` ${col.cls}` : ''}`,
        text: `${col.label}${arrow}`,
        onclick: () => {
          if (ui.sortKey === col.id) ui.sortDir = -ui.sortDir;
          else {
            ui.sortKey = col.id;
            ui.sortDir = -1;
          }
          renderBoardView();
        },
      });
    });

    const bodyRows = rows.map((r) => {
      const d = r.change_7d;
      const deltaCls = d === null ? 'delta-flat' : d > 0 ? 'delta-pos' : d < 0 ? 'delta-neg' : 'delta-flat';
      const fillPct = Math.max(2, (100 * r.implied_value_usd) / topImplied).toFixed(1);
      const mult = (r.implied_value_usd / r.tvl_usd).toFixed(2);

      return h(
        'tr',
        { class: 'data-row', onclick: () => openDetailSheet(r.slug) },
        h('td', { class: 'col-rank' }, h('strong', { text: String(r.rank) })),
        h(
          'td',
          { class: 'proto-cell' },
          h(
            'div',
            { class: 'proto-title' },
            r.name,
            r.watchlisted
              ? h('span', { class: 'tag-badge tag-watch', text: 'watchlist' })
              : h('span', { class: 'tag-badge tag-early', text: 'early' }),
          ),
          h('div', { class: 'proto-meta', text: `${r.slug} \u00b7 ${r.chains.slice(0, 3).join(', ')}` }),
        ),
        h(
          'td',
          { class: 'cat-cell hide-mobile' },
          r.category || 'Uncategorized',
          h('span', { class: 'peer-sub', text: r.category_peers ? `${r.category_peers} live peers (x${r.category_multiplier.toFixed(2)})` : 'curve prior' }),
        ),
        h('td', { class: 'mono', text: formatUsd(r.tvl_usd) }),
        h('td', { class: `mono ${deltaCls}`, text: formatDelta(d) }),
        h('td', { class: 'mono hide-mobile', text: formatDuration(r.age_days) }),
        h('td', { class: 'mono hide-mobile', text: `~$${r.est_farm_cost_usd}` }),
        h(
          'td',
          null,
          h(
            'div',
            { class: 'val-meter' },
            h('div', { class: 'val-top' }, h('span', { class: 'val-figure', text: formatUsd(r.implied_value_usd) }), h('span', { class: 'val-mult', text: `${mult}x` })),
            h('div', { class: 'val-track' }, h('div', { class: 'val-fill', style: `width:${fillPct}%` })),
          ),
        ),
      );
    });

    stage.appendChild(
      h(
        'div',
        { class: 'table-shell', id: 'board-table' },
        h('table', null, h('thead', null, h('tr', null, headers)), h('tbody', null, bodyRows)),
      ),
    );

    if (!rows.length) {
      stage.appendChild(h('div', { class: 'empty-state', text: 'No protocols match the current filters.' }));
    }

    const counter = document.getElementById('visible-count');
    if (counter) counter.textContent = `${rows.length} / ${dataset.board_total} rows`;
  }

  function renderLiveView() {
    stage.textContent = '';
    const stack = h('div', { class: 'section-stack' });
    stack.appendChild(
      h('p', {
        class: 'live-intro',
        text: `Live-token protocols are strictly separated from the pre-token board and used to fit the ${dataset.params.version} Huber curve across ${dataset.validation.live_fit_count} peers.`,
      }),
    );

    // Category empirical summary
    const calEntries = Object.entries(dataset.category_calibration).sort((a, b) => b[1].peers - a[1].peers);
    const calHead = ['Category', 'Live Peers', 'Median Mcap/TVL', 'EB Curve Adj.'].map((t) => h('th', { scope: 'col', text: t }));
    const calBody = calEntries.slice(0, 14).map(([cat, c]) =>
      h(
        'tr',
        null,
        h('td', { text: cat }),
        h('td', { class: 'mono', text: String(c.peers) }),
        h('td', { class: 'mono', text: `${c.median_ratio.toFixed(3)}x` }),
        h('td', { class: 'mono', text: `x${Math.exp(c.log_adjustment).toFixed(3)}` }),
      ),
    );
    stack.appendChild(h('div', { class: 'table-shell' }, h('table', null, h('thead', null, h('tr', null, calHead)), h('tbody', null, calBody))));

    // Live token benchmarks
    const head = ['Protocol', 'Category', 'Chains', 'TVL', 'Market Cap', 'Mcap/TVL', '7d Delta'].map((label) =>
      h('th', { scope: 'col', text: label }),
    );
    const body = dataset.live.map((r) => {
      const cls = r.change_7d === null ? 'delta-flat' : r.change_7d > 0 ? 'delta-pos' : 'delta-neg';
      return h(
        'tr',
        null,
        h('td', { class: 'proto-cell' }, h('div', { class: 'proto-title', text: r.name }), h('div', { class: 'proto-meta', text: r.slug })),
        h('td', { class: 'cat-cell', text: r.category || 'Uncategorized' }),
        h('td', { class: 'chain-cell', text: r.chains.slice(0, 4).join(', ') }),
        h('td', { class: 'mono', text: formatUsd(r.tvl_usd) }),
        h('td', { class: 'mono', text: formatUsd(r.mcap_usd) }),
        h('td', { class: 'mono', text: `${r.mcap_tvl_ratio.toFixed(2)}x` }),
        h('td', { class: `mono ${cls}`, text: formatDelta(r.change_7d) }),
      );
    });
    stack.appendChild(h('div', { class: 'table-shell' }, h('table', null, h('thead', null, h('tr', null, head)), h('tbody', null, body))));
    stage.appendChild(stack);
  }

  function renderMethodologyView() {
    const p = dataset.params;
    const v = dataset.validation;
    stage.textContent = '';

    const wrap = h(
      'div',
      { class: 'method-wrap' },
      h(
        'div',
        { class: 'card-block' },
        h('h2', { text: `Empirical Peer-Curve Valuation (${p.version})` }),
        h('p', { text: `Fitted dynamically on all ${v.live_fit_count} live-token protocols in snapshot.json with zero hardcoded protocol names:` }),
        h(
          'div',
          { class: 'code-box', style: 'margin-top:12px' },
          `curveBase  = exp(${p.alpha.toFixed(4)} + ${p.beta.toFixed(4)} * ln(tvl_usd))\n` +
            `catMult    = exp((n_cat / (n_cat + ${p.shrinkage_k})) * clamp(med_res_cat, -${p.cat_adj_cap}, ${p.cat_adj_cap}))\n` +
            `growthMult = 1 + (clamp(change_7d, ${p.momentum_min_pct}, ${p.momentum_max_pct}) / 100) * (g >= 0 ? ${p.momentum_pos_weight} : ${p.momentum_neg_weight})\n` +
            `maturity   = ${p.maturity_base} + min(age_days, ${p.maturity_horizon_days}) / ${p.maturity_horizon_days} * ${p.maturity_span}\n` +
            `chainMult  = 1 + min(${p.max_extra_chains}, max(0, chains - 1)) * ${p.chain_step}\n` +
            'implied    = max(1, round(curveBase * catMult * growthMult * maturity * chainMult))',
        ),
      ),
      h(
        'div',
        { class: 'card-block' },
        h('h3', { text: 'Out-of-Sample Leave-One-Out Cross-Validation (119 Live Tokens)' }),
        h(
          'div',
          { class: 'kv-grid' },
          h('span', { class: 'lbl', text: 'peer-curve-v2 LOO RMSLE' }),
          h('span', { class: 'mono', text: `${v.loo_rmsle} (median fold error: ${v.loo_median_fold}x)` }),
          h('span', { class: 'lbl', text: 'Naive 0.22x TVL Baseline' }),
          h('span', { class: 'mono', text: `${v.baseline_rmsle} (median fold error: ${v.baseline_median_fold}x)` }),
          h('span', { class: 'lbl', text: 'Out-of-sample Error Reduction' }),
          h('span', { class: 'mono delta-pos', text: `${v.error_reduction_pct}% tighter median fold error` }),
        ),
      ),
      h(
        'div',
        { class: 'card-block' },
        h('h3', { text: 'Universe Hygiene & Snapshot Provenance' }),
        h(
          'ul',
          null,
          h('li', null, `Covers all ${dataset.watchlist_total} watchlist slugs plus ${dataset.early_total} genuine pre-token protocols below ${formatUsd(dataset.floor_usd)} (excluding wrapped, staked, bridged, and exchange products).`),
          h('li', null, 'Implied values are model estimates conditional on current snapshot metrics and never guarantee a token launch or airdrop allocation.'),
        ),
        h(
          'div',
          { class: 'kv-grid' },
          h('span', { class: 'lbl', text: 'Snapshot Date' }),
          h('span', { class: 'mono', text: dataset.as_of }),
          h('span', { class: 'lbl', text: 'Source Feed' }),
          h('span', { class: 'mono', text: dataset.source }),
          h('span', { class: 'lbl', text: 'Universe' }),
          h('span', { class: 'mono', text: `${dataset.total_universe} protocols (>= $5M TVL)` }),
        ),
      ),
    );

    stage.appendChild(wrap);
  }

  function closeDetailSheet() {
    const sheet = document.getElementById('detail-sheet');
    if (sheet) {
      sheet.classList.remove('open');
      setTimeout(() => sheet.remove(), 220);
    }
    ui.activeSlug = null;
  }

  function openDetailSheet(slug) {
    const row = dataset.rows.find((r) => r.slug === slug);
    if (!row) return;
    ui.activeSlug = slug;

    const existing = document.getElementById('detail-sheet');
    if (existing) existing.remove();

    const check = recomputeValuation(row);
    const isExact = check.impliedUsd === row.implied_value_usd;
    const plan = buildProtocolPlan(row);
    const deltaCls = row.change_7d > 0 ? 'delta-pos' : row.change_7d < 0 ? 'delta-neg' : '';

    const stepNodes = plan.steps.map((st, idx) =>
      h(
        'div',
        { class: 'plan-step' },
        h('div', { class: 'step-num', text: String(idx + 1) }),
        h(
          'div',
          { style: 'flex:1' },
          h('div', { class: 'step-copy', text: st.instruction }),
          h(
            'div',
            { class: 'step-chips' },
            h('span', { class: 'chip-cost', text: `Cost: ${st.expense}` }),
            h('span', { class: 'chip-time', text: `Time: ${st.duration}` }),
          ),
        ),
      ),
    );

    const sheet = h(
      'aside',
      { class: 'detail-sheet open', id: 'detail-sheet', 'aria-label': `${row.name} details` },
      h(
        'div',
        { class: 'sheet-scroll' },
        h('button', { type: 'button', class: 'close-btn', text: 'Close \u2715', onclick: closeDetailSheet }),
        h(
          'div',
          { class: 'sheet-head' },
          h(
            'h2',
            { style: 'display:inline' },
            row.name,
            row.watchlisted
              ? h('span', { class: 'tag-badge tag-watch', text: 'watchlist' })
              : h('span', { class: 'tag-badge tag-early', text: 'early find' }),
          ),
          h('div', { class: 'sheet-sub', text: `Rank #${row.rank} \u00b7 ${row.slug} \u00b7 ${row.category || 'Uncategorized'}` }),
          h('div', { class: 'sheet-sub', text: `${row.chains.join(', ') || 'Unknown chain'} \u00b7 pre-token (no token recorded)` }),
        ),
        h(
          'div',
          { class: 'metric-pair' },
          h('div', { class: 'metric-box' }, h('div', { class: 'metric-k', text: 'TVL' }), h('div', { class: 'metric-v', text: formatUsd(row.tvl_usd) })),
          h('div', { class: 'metric-box' }, h('div', { class: 'metric-k', text: '7d Delta' }), h('div', { class: `metric-v ${deltaCls}`, text: formatDelta(row.change_7d) })),
          h('div', { class: 'metric-box' }, h('div', { class: 'metric-k', text: 'Age (Listed)' }), h('div', { class: 'metric-v', text: `${formatDuration(row.age_days)} (${row.listed_at || 'n/a'})` })),
          h('div', { class: 'metric-box' }, h('div', { class: 'metric-k', text: 'Est. Gas Cost' }), h('div', { class: 'metric-v', text: `~$${plan.totalGasUsd} (${row.chains[0] || 'main'})` })),
        ),
        h(
          'div',
          { class: 'card-block' },
          h('h3', null, 'Empirical Valuation Breakdown \u00b7 ', h('span', { class: 'mono', text: formatUsd(row.implied_value_usd) })),
          h(
            'div',
            { class: 'code-box' },
            `curveBase  exp(${dataset.params.alpha.toFixed(2)} + ${dataset.params.beta.toFixed(2)}*ln TVL) = ${formatUsd(check.curveBaseUsd)}\n` +
              `category   ${check.catPeers} live peers -> x${check.catMult.toFixed(3)}\n` +
              `momentum   ${formatDelta(check.growthPct)} -> x${check.growthMult.toFixed(3)}\n` +
              `maturity   ${formatDuration(row.age_days)} -> x${check.maturityMult.toFixed(3)}  | chains -> x${check.chainMult.toFixed(2)}\n` +
              `implied    = ${formatUsd(check.impliedUsd)} (${(row.implied_value_usd / row.tvl_usd).toFixed(3)}x TVL)`,
          ),
          h(
            'div',
            { class: `verify-line${isExact ? '' : ' err'}` },
            h('span', { class: 'verify-dot' }),
            isExact
              ? 'verified in-page: browser recomputation matches board.json exactly'
              : `mismatch detected: ${formatUsd(check.impliedUsd)} vs ${formatUsd(row.implied_value_usd)}`,
          ),
        ),
        h(
          'div',
          { class: 'card-block' },
          h('h3', null, 'Chain-Aware Farm Plan', h('span', { class: 'plan-summary', text: `$${plan.capitalUsd} cap \u00b7 ${plan.holdDays}d \u00b7 gas ~$${plan.totalGasUsd}` })),
          ...stepNodes,
        ),
      ),
    );

    document.body.appendChild(sheet);
  }

  function switchTab(nextTab) {
    ui.tab = nextTab;
    for (const id of ['board', 'live', 'method']) {
      const btn = document.getElementById(`nav-${id}`);
      const on = id === nextTab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const showBoard = nextTab === 'board';
    document.getElementById('kpi-grid').style.display = showBoard ? '' : 'none';
    document.getElementById('chart-grid').style.display = showBoard ? '' : 'none';
    document.getElementById('filter-bar').style.display = showBoard ? '' : 'none';
    if (document.getElementById('detail-sheet')) closeDetailSheet();
    if (nextTab === 'board') renderBoardView();
    else if (nextTab === 'live') renderLiveView();
    else renderMethodologyView();
  }

  document.getElementById('nav-board').addEventListener('click', () => switchTab('board'));
  document.getElementById('nav-live').addEventListener('click', () => switchTab('live'));
  document.getElementById('nav-method').addEventListener('click', () => switchTab('method'));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeDetailSheet();
  });

  document.getElementById('footer-disclaimer').textContent =
    `Sealed snapshot ${dataset.as_of} (${dataset.source}) \u00b7 Valuations are fitted empirically via ${dataset.params.version} on ${dataset.validation.live_fit_count} live protocols and are not financial advice or token launch guarantees.`;

  populateHeaderPills();
  renderKpis();
  renderCharts();
  renderFilterBar();
  renderBoardView();
})();
