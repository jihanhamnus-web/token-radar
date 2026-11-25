// Token Radar static dashboard: consumes window.RADAR (generated beside dashboard/ by main.ts).
// Renders ranked launch board, filters/sorting, per-protocol detail drawer with verified in-page
// model arithmetic and costed farm plan, plus Live tokens and How it works views. No network.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('view');
  var state = { tab: 'board', q: '', category: 'all', chain: 'all', scope: 'all', sort: 'implied', dir: -1, open: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Exact browser mirror of impliedValue in lib/model.ts for per-row verification.
  function impliedOf(row) {
    var m = DATA.model;
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, raw));
    var weight = growth >= 0 ? m.growth_weight_pos : m.growth_weight_neg;
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var clamped = Math.min(Math.max(age, 0), m.maturity_days);
    var maturity = m.maturity_floor + (clamped / m.maturity_days) * m.maturity_range;
    var base = row.tvl_usd * m.base_multiple;
    return {
      base: base,
      growthPct: growth,
      growthMult: growthMult,
      maturity: maturity,
      implied: Math.max(1, Math.round(base * growthMult * maturity)),
    };
  }

  function capitalFor(tvl) {
    if (tvl >= 1e9) return 250;
    if (tvl >= 250e6) return 150;
    if (tvl >= 50e6) return 100;
    if (tvl >= 15e6) return 75;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null) return 45;
    if (age < 90) return 90;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var nm = row.name;
    if (/lend|cdp|collateral|money market|rist/.test(c))
      return 'Supply $' + capital + ' of USDC to ' + nm + ' on ' + chain + ', borrow the smallest amount that still counts as activity, and keep both sides open.';
    if (/dex|yield|leveraged farm|amm/.test(c))
      return 'Provide $' + capital + ' of liquidity split across both sides of ' + nm + "'s deepest stable pool on " + chain + ' and hold the LP receipt.';
    if (/bridge/.test(c))
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + nm + ', leave the bridged funds in its app for the hold window, and bridge back only at the end.';
    if (/staking|restak/.test(c))
      return 'Stake $' + capital + " of the chain's staking asset through " + nm + ' on ' + chain + ' and keep the liquid receipt in the same wallet.';
    if (/perpetual|derivative|leverage/.test(c))
      return 'Deposit $' + capital + ' of USDC as margin on ' + nm + ' on ' + chain + ', open one small position, then keep the margin untouched while it stays open.';
    if (/prediction|betting|market/.test(c))
      return 'Fund ' + capital + ' of USDC in a fresh ' + nm + ' wallet on ' + chain + ' and place one small position with a clear end date.';
    if (/curat|allocat|vault|restaked/.test(c))
      return 'Deposit $' + capital + ' of USDC or stETH into the ' + nm + ' vault on ' + chain + ' and hold the vault shares for the full window.';
    if (/stable/.test(c))
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + nm + ' on ' + chain + ', park the minted balance in its yield venue, and hold it.';
    if (/rwa|tokenized/.test(c))
      return 'Subscribe to or mint $' + capital + ' of ' + nm + "'s tokenized yield asset on " + chain + ' and hold it in the farm wallet.';
    if (/insurance|risk/.test(c))
      return 'Buy $' + capital + ' of cover for one active position through ' + nm + ' on ' + chain + ' and keep the policy for its full term.';
    return 'Deposit $' + capital + ' of USDC into ' + nm + ' on ' + chain + ', take one qualifying action, and keep the position open.';
  }
  function farmPlan(row) {
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
    var gas = capital >= 150 ? 'about $8' : 'about $4';
    var weeklyGas = 2 * Math.round(hold / 7);
    return [
      { text: 'Open a fresh farm wallet that holds only what you plan to commit: fund it with $' + capital + ' of USDC (or the chain\u2019s own gas asset) and store the seed phrase offline, never in a screenshot or a cloud note.', cost: 'the $' + capital + ' you commit, plus a network fee to fund the wallet', time: 'about 10 minutes' },
      { text: 'Read ' + row.name + '\u2019s own docs for the deposit route on ' + chain + ' and copy the contract address from its official page only; airdrop farming is where wallet-drain scams live, so never approve a site you reached from a reply or a DM.', cost: 'free to read the docs and verify the address', time: '15 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' of gas', time: 'about 15 minutes' },
      { text: 'Keep one qualifying action a week, such as a deposit, a borrow, a swap or a governance vote: most launch or points programs look for sustained activity across several weeks, not a single deposit followed by silence.', cost: 'about $2 of gas a week, roughly $' + Math.max(8, weeklyGas) + ' across the window', time: '10 minutes a week for ' + hold + ' days' },
      { text: 'Hold the position for the full ' + hold + '-day window, longer than any snapshot cycle, and check the protocol\u2019s own points or campaign page once a month: if a page asks a fee to claim rewards, it is not the protocol\u2019s, so leave it.', cost: 'the $' + capital + ' stays in the position; claiming a real reward costs only gas', time: hold + ' days, one check a month' },
      { text: 'Watch for the token-announcement moments: a snapshot, a points freeze or a mint list. If a token appears, check the claim contract against ' + row.name + '\u2019s own announcement before you sign anything, and never enter your seed phrase on any claim page.', cost: 'nothing beyond attention; never pay to claim', time: '10 minutes each time' },
      { text: 'Log the wallet address, every transaction hash, the dates and the position size in your own farm log, so you can prove your activity window, repeat the position, or unwind it cleanly if the protocol never issues a token.', cost: 'nothing but the log entry', time: '5 minutes to write, 1 minute to update' }
    ];
  }

  // Header metadata pills
  var metaAsof = document.getElementById('meta-asof');
  metaAsof.textContent = '';
  metaAsof.appendChild(el('span', null, 'snapshot ', el('b', { text: DATA.as_of })));
  var metaModel = document.getElementById('meta-model');
  metaModel.textContent = '';
  metaModel.appendChild(el('span', null, 'model ', el('b', { text: DATA.model_version })));
  var metaCount = document.getElementById('meta-count');
  metaCount.textContent = '';
  metaCount.appendChild(el('span', null, el('b', { text: String(DATA.board_size) }), ' rows'));

  function renderStats() {
    var host = document.getElementById('stats');
    host.textContent = '';
    var rows = DATA.rows;
    var watched = rows.filter(function (r) { return r.on_watchlist; }).length;
    var early = DATA.board_size - watched;
    var surge = rows.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; }).length;
    host.appendChild(el('div', { class: 'stat is-accent' }, el('div', { class: 'k', text: 'Total implied value' }),
      el('div', { class: 'v', text: fmtUsd(DATA.total_implied_usd) }), el('div', { class: 'd', text: 'sum of the board\u2019s ranked rows' })));
    host.appendChild(el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Watchlist coverage' }),
      el('div', { class: 'v', text: watched + ' / ' + DATA.watchlist_size }),
      el('div', { class: 'd', text: 'every watchlist protocol is ranked' })));
    host.appendChild(el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Early finds' }),
      el('div', { class: 'v', text: String(early) }), el('div', { class: 'd', text: 'pre-token, below the $50M watchlist floor' })));
    host.appendChild(el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Board rows' }),
      el('div', { class: 'v', text: String(DATA.board_size) }), el('div', { class: 'd', text: 'ranked by implied launch value' })));
    host.appendChild(el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Growing this week' }),
      el('div', { class: 'v', text: String(surge) }), el('div', { class: 'd', text: 'positive 7-day TVL change' })));
  }

  function renderToolbar() {
    var host = document.getElementById('toolbar');
    host.textContent = '';
    var q = el('input', { type: 'search', placeholder: 'Search protocol or chain\u2026', value: state.q,
      oninput: function () { state.q = this.value.toLowerCase(); renderBoard(); } });
    var cat = el('select', { 'aria-label': 'Category filter', onchange: function () { state.category = this.value; renderBoard(); } },
      el('option', { value: 'all', text: 'All categories' }));
    DATA.categories.forEach(function (c) { cat.appendChild(el('option', { value: c, text: c, selected: state.category === c ? '' : null })); });
    var chain = el('select', { 'aria-label': 'Chain filter', onchange: function () { state.chain = this.value; renderBoard(); } },
      el('option', { value: 'all', text: 'All chains' }));
    DATA.chains.slice(0, 40).forEach(function (c) { chain.appendChild(el('option', { value: c, text: c, selected: state.chain === c ? '' : null })); });
    var scopes = [
      { id: 'all', label: 'All rows' },
      { id: 'watch', label: 'Watchlist only' },
      { id: 'early', label: 'Early finds only' },
      { id: 'surge', label: 'Growing 7d' }
    ];
    var chips = scopes.map(function (s) {
      return el('button', { class: 'chip' + (state.scope === s.id ? ' is-on' : ''), type: 'button', onclick: function () {
        state.scope = s.id; renderToolbar(); renderBoard();
      } }, s.label);
    });
    host.appendChild(q); host.appendChild(cat); host.appendChild(chain);
    chips.forEach(function (c) { host.appendChild(c); });
    var matches = visibleRows().length;
    host.appendChild(el('span', { class: 'hint', text: matches + ' of ' + DATA.board_size + ' rows shown' }));
  }

  function visibleRows() {
    var q = state.q;
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (state.scope === 'watch' && !r.on_watchlist) return false;
      if (state.scope === 'early' && r.on_watchlist) return false;
      if (state.scope === 'surge' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  var COLUMNS = [
    { id: 'rank', label: 'Rank', sortable: true },
    { id: 'name', label: 'Protocol', sortable: true },
    { id: 'category', label: 'Category', sortable: true, cls: 'hide-sm' },
    { id: 'tvl', label: 'TVL', sortable: true },
    { id: 'chg', label: '7d', sortable: true },
    { id: 'age', label: 'Age', sortable: true, cls: 'hide-sm' },
    { id: 'implied', label: 'Implied launch value', sortable: true }
  ];

  function sortRows(rows) {
    var dir = state.dir, key = state.sort;
    var val = function (r) {
      if (key === 'rank') return r.rank;
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'category') return (r.category || '').toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'chg') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      return r.implied_value_usd;
    };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
  }

  function renderBoard() {
    var rows = sortRows(visibleRows());
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    app.textContent = '';
    var head = COLUMNS.map(function (c) {
      var on = state.sort === c.id;
      var cls = c.cls ? 'sortable ' + c.cls : 'sortable';
      return el('th', { class: cls, scope: 'col', onclick: function () {
        if (state.sort === c.id) state.dir = -state.dir; else { state.dir = -1; state.sort = c.id; }
        renderBoard();
      } }, c.label + (on ? (state.dir === -1 ? ' \u25bc' : ' \u25b2') : ''));
    });
    var body = rows.map(function (r) {
      var chg = r.change_7d;
      var chgCls = chg === null ? 'chg flat' : chg > 0 ? 'chg up' : chg < 0 ? 'chg down' : 'chg flat';
      var pct = 100 * r.implied_value_usd / max;
      return el('tr', { class: 'row', onclick: function () { openDrawer(r.slug); } },
        el('td', { class: 'rank' }, el('b', { text: String(r.rank) })),
        el('td', { class: 'proto' },
          el('div', { class: 'n' }, r.name,
            r.on_watchlist ? el('span', { class: 'badge watch', text: 'watchlist' }) : el('span', { class: 'badge early', text: 'early' })),
          el('div', { class: 's', text: r.slug + '  \u00b7  ' + r.chains.slice(0, 3).join(', ') })),
        el('td', { class: 'cat hide-sm', text: r.category || 'uncategorised' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + chgCls, text: fmtPct(chg) }),
        el('td', { class: 'num hide-sm', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'vbar' },
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
          el('div', { class: 'bar', style: 'width:' + Math.max(1.5, pct).toFixed(1) + '%' }))));
    });
    app.appendChild(el('div', { class: 'board-wrap', id: 'board' },
      el('table', null, el('thead', null, el('tr', null, head)), el('tbody', null, body))));
    if (!rows.length) {
      app.appendChild(el('div', { class: 'empty', text: 'No rows match these filters.' }));
    }
    var hint = document.getElementById('toolbar').lastChild;
    if (hint && hint.className === 'hint') hint.textContent = rows.length + ' of ' + DATA.board_size + ' rows shown';
  }

  function renderLive() {
    app.textContent = '';
    var rows = DATA.live;
    var head = ['Protocol', 'Category', 'Chains', 'TVL', 'Market cap', '7d']
      .map(function (h) { return el('th', { scope: 'col', text: h }); });
    var body = rows.map(function (r) {
      var chg = r.change_7d;
      var cls = chg === null ? 'flat' : chg > 0 ? 'up' : 'down';
      return el('tr', null,
        el('td', { class: 'proto' }, el('div', { class: 'n', text: r.name }), el('div', { class: 's', text: r.slug })),
        el('td', { class: 'cat', text: r.category || 'uncategorised' }),
        el('td', { class: 'chains', text: r.chains.slice(0, 4).join(', ') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num mc', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num chg ' + cls, text: fmtPct(chg) }));
    });
    app.appendChild(el('p', { class: 'hint', text: 'Protocols whose token already trades: the market prices them itself, so the ranked board keeps them apart. Their mcap/TVL ratio is the live comparison for the launch board\u2019s implied multiple.' }));
    app.appendChild(el('div', { class: 'board-wrap' },
      el('table', null, el('thead', null, el('tr', null, head)), el('tbody', null, body))));
  }

  function renderMethod() {
    var m = DATA.model;
    app.textContent = '';
    var wrap = el('div', { class: 'method' });
    wrap.appendChild(el('div', { class: 'panel' },
      el('h2', { text: 'How the implied launch value is computed' }),
      el('p', null, 'Every ranked row is scored by the same function (' + DATA.model_version + '), from the snapshot\u2019s own figures alone:'),
      el('div', { class: 'formula' },
        'base       = tvl_usd \u00d7 ' + m.base_multiple + '\n' +
        'growth     = clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') per cent\n' +
        'growthMult = 1 + growth/100 \u00d7 (growth \u2265 0 ? ' + m.growth_weight_pos + ' : ' + m.growth_weight_neg + ')\n' +
        'maturity   = ' + m.maturity_floor + ' + min(age_days,' + m.maturity_days + ')/' + m.maturity_days + ' \u00d7 ' + m.maturity_range + '\n' +
        'implied    = round(base \u00d7 growthMult \u00d7 maturity)')));
    wrap.appendChild(el('div', { class: 'panel' },
      el('h3', { text: 'What each factor means' }),
      el('ul', null,
        el('li', null, el('b', null, 'Base: '), 'a launch multiple of deposited capital. Tokens of live protocols in this snapshot trade at widely varying mcap/TVL ratios; 0.22 is a deliberately conservative share of TVL used for every row alike.'),
        el('li', null, el('b', null, 'Growth: '), 'seven-day TVL momentum. Positive growth is rewarded at half weight; drawdowns are penalised at 0.9, because a shrinking TVL at launch is a worse signal than a flat one.'),
        el('li', null, el('b', null, 'Maturity: '), 'how long the protocol has run with no token (days since DefiLlama first listed it). A record kept across seasons supports a bigger launch; the factor saturates at three years, and an unknown age counts as one year.'))));
    wrap.appendChild(el('div', { class: 'panel' },
      el('h3', { text: 'The board, the watchlist and what is not claimed' }),
      el('ul', null,
        el('li', null, 'A protocol is ', el('b', null, 'pre-token'), ' only when its DefiLlama record carries no market cap, no CoinGecko id and no symbol \u2014 the record shows no token, which is never proof that none exists.'),
        el('li', null, 'The ', el('b', null, 'watchlist'), ' (' + DATA.watchlist_size + ' protocols, all covered) is the house\u2019s floor: TVL at or above $50M, no token recorded, and not a wrapped, staked or bridged product of a token that already trades. The board adds ' + DATA.early_size + ' early rows below the floor: the radar exists to find them.'),
        el('li', null, 'Protocols whose token already trades are shown in the ', el('b', null, 'Live tokens'), ' view with the market\u2019s own numbers, never mixed into the ranked board.'),
        el('li', null, 'The implied value is this model\u2019s claim about what the token would be worth if the record stayed as it is \u2014 it does not predict whether or when a token is issued, and it is never advice to buy anything.'))));
    wrap.appendChild(el('div', { class: 'panel' },
      el('h3', { text: 'Farm plans' }),
      el('p', null, 'Every row carries a seven-step farm plan with a cost and a time on each step, derived from the protocol\u2019s own record: position size from its TVL tier, hold window from its age, the action from its category. The plan targets one purpose \u2014 being an on-record active user before a token, a snapshot or a points freeze. Open any row to read it.')));
    wrap.appendChild(el('div', { class: 'panel' },
      el('h3', { text: 'The snapshot' }),
      el('div', { class: 'kv' },
        el('span', { class: 'k', text: 'as of' }), el('span', { class: 'v', text: DATA.as_of }),
        el('span', { class: 'k', text: 'source' }), el('span', { class: 'v', text: DATA.source }),
        el('span', { class: 'k', text: 'protocols tracked' }), el('span', { class: 'v', text: '758 at \u2265$5M TVL' }),
        el('span', { class: 'k', text: 'watchlist floor' }), el('span', { class: 'v', text: fmtUsd(DATA.floor_usd) }),
        el('span', { class: 'k', text: 'board' }), el('span', { class: 'v', text: DATA.board_size + ' ranked rows' }))));
    app.appendChild(wrap);
  }

  function openDrawer(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) row = DATA.rows[i];
    if (!row) return;
    state.open = slug;
    var m = DATA.model;
    var calc = impliedOf(row);
    var match = calc.implied === row.implied_value_usd;
    var plan = farmPlan(row);
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var weeklyGas = 2 * Math.round(hold / 7);
    var old = document.getElementById('drawer');
    if (old) old.remove();
    var steps = plan.map(function (s, idx) {
      return el('div', { class: 'step' },
        el('div', { class: 'no', text: String(idx + 1) }),
        el('div', { style: 'flex:1' },
          el('div', { class: 't', text: s.text }),
          el('div', { class: 'tags' },
            el('span', { class: 'cost', text: 'cost: ' + s.cost }),
            el('span', { class: 'dur', text: 'time: ' + s.time }))));
    });
    var drawer = el('aside', { class: 'drawer is-open', id: 'drawer', 'aria-label': row.name + ' detail' },
      el('div', { class: 'inner' },
        el('button', { class: 'close', type: 'button', onclick: closeDrawer, text: 'Close \u2715' }),
        el('div', { class: 'head' },
          el('h2', { text: row.name + ' ', style: 'display:inline' }),
          row.on_watchlist ? el('span', { class: 'badge watch', text: 'watchlist' }) : el('span', { class: 'badge early', text: 'early find' }),
          el('div', { class: 'slugline', text: 'rank #' + row.rank + '  \u00b7  ' + row.slug + '  \u00b7  ' + (row.category || 'uncategorised') }),
          el('div', { class: 'slugline', text: (row.chains.length ? row.chains.join(', ') : 'chain unknown') + '  \u00b7  token status: pre-token (no token on record)' })),
        el('div', { class: 'grid2' },
          el('div', { class: 'tile' }, el('div', { class: 'k', text: 'TVL' }), el('div', { class: 'v', text: fmtUsd(row.tvl_usd) })),
          el('div', { class: 'tile' }, el('div', { class: 'k', text: '7d change' }),
            el('div', { class: 'v ' + (row.change_7d > 0 ? 'up' : row.change_7d < 0 ? 'down' : ''), text: fmtPct(row.change_7d) })),
          el('div', { class: 'tile' }, el('div', { class: 'k', text: 'Age (no token)' }),
            el('div', { class: 'v', text: fmtAge(row.age_days) })),
          el('div', { class: 'tile' }, el('div', { class: 'k', text: 'Tracked since' }),
            el('div', { class: 'v', text: row.listed_at || 'unknown' }))),
        el('div', { class: 'panel' },
          el('h3', null, 'Implied launch value \u00b7 ', el('span', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
          el('div', { class: 'formula' },
            'base      ' + fmtUsd(row.tvl_usd) + ' \u00d7 ' + m.base_multiple + ' = ' + calc.base.toFixed(0) + '\n' +
            'growth    ' + fmtPct(calc.growthPct) + ' \u2192 \u00d7' + calc.growthMult.toFixed(3) + '\n' +
            'maturity  ' + fmtAge(row.age_days) + ' \u2192 \u00d7' + calc.maturity.toFixed(3) + '\n' +
            'implied   = ' + fmtUsd(calc.implied)),
          el('div', { class: 'fline' },
            el('span', { class: 'where', text: 'value per dollar of TVL' }),
            el('span', { class: 'what', text: (row.implied_value_usd / row.tvl_usd).toFixed(3) + '\u00d7' })),
          el('div', { class: match ? 'verified' : 'verified mismatch' },
            el('span', { class: 'dot' }),
            match ? 'verified in-page: recomputing this row from the snapshot figures gives the value board.json carries'
              : 'mismatch: the page\u2019s recomputation differs from board.json (' + fmtUsd(calc.implied) + ' vs ' + fmtUsd(row.implied_value_usd) + ')')),
        el('div', { class: 'panel' },
          el('h3', null, 'Farm plan', el('span', { class: 'total-cost', text: 'position: $' + capital + ' \u00b7 window: ' + hold + ' days \u00b7 gas \u2248 $' + Math.max(8, weeklyGas) })),
          steps)));
    document.body.appendChild(drawer);
  }
  function closeDrawer() {
    var d = document.getElementById('drawer');
    if (d) { d.classList.remove('is-open'); setTimeout(function () { d.remove(); }, 220); }
    state.open = null;
  }

  function setTab(tab) {
    state.tab = tab;
    ['board', 'live', 'method'].forEach(function (t) {
      var btn = document.getElementById('tab-' + t);
      btn.classList.toggle('is-on', t === tab);
      btn.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    document.getElementById('stats').style.display = tab === 'board' ? '' : 'none';
    document.getElementById('toolbar').style.display = tab === 'board' ? '' : 'none';
    if (document.getElementById('drawer')) closeDrawer();
    if (tab === 'board') renderBoard();
    else if (tab === 'live') renderLive();
    else renderMethod();
  }
  document.getElementById('tab-board').addEventListener('click', function () { setTab('board'); });
  document.getElementById('tab-live').addEventListener('click', function () { setTab('live'); });
  document.getElementById('tab-method').addEventListener('click', function () { setTab('method'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  document.getElementById('foot-note').textContent =
    'Snapshot sealed ' + DATA.as_of + ' \u00b7 ' + DATA.source + ' \u00b7 the implied value is this model\u2019s own claim (' +
    DATA.model_version + '), derived from the snapshot\u2019s figures; it is not a prediction or advice.';

  renderStats();
  renderToolbar();
  renderBoard();
})();
