// Runner em segundo plano (Capacitor Background Runner).
// Recebe a configuração do app via evento `saveConfig` e, periodicamente
// (`checkDividends`), consulta a fonte de proventos para avisar sobre anúncios novos.
// Ambiente restrito: sem DOM, sem módulos; só fetch, CapacitorKV e CapacitorNotifications.

var CONFIG_KEY = 'grefinacia.config';
var SEEN_KEY = 'grefinacia.seenKeys';

function readJSON(key, fallback) {
  try {
    var v = CapacitorKV.get(key);
    var raw = v && typeof v === 'object' ? v.value : v;
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function isoDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined; }

function prevBusinessDay(dateStr) {
  var p = dateStr.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2], 12);
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return ymd(d);
}

function kindOf(label, type) {
  var s = String(label || '').toUpperCase();
  if (s.indexOf('JCP') >= 0 || s.indexOf('JUROS') >= 0) return 'jcp';
  if (s.indexOf('AMORT') >= 0 || s.indexOf('RESTITUI') >= 0) return 'amortizacao';
  if (s.indexOf('RENDIMENTO') >= 0) return 'rendimento';
  if (s.indexOf('DIVIDENDO') >= 0) return type === 'fii' ? 'rendimento' : 'dividendo';
  return type === 'fii' ? 'rendimento' : 'outro';
}

// Mesmo formato de chave usado pelo app, para não repetir avisos já conhecidos.
function keyOf(ticker, kind, dataCom, rate) {
  return [ticker.toUpperCase(), kind, dataCom || '', rate.toFixed(8)].join('|');
}

async function getJSON(url, headers) {
  var res = await fetch(url, { headers: Object.assign({ Accept: 'application/json' }, headers || {}) });
  if (res.status !== 200) return null;
  return await res.json();
}

async function fetchEvents(cfg, asset) {
  var out = [];
  var start = new Date();
  start.setMonth(start.getMonth() - 24);
  if (cfg.provider === 'yahoo') {
    var y = await getJSON('https://query1.finance.yahoo.com/v8/finance/chart/' + asset.ticker + '.SA?range=2y&interval=1d&events=div');
    var divs = y && y.chart && y.chart.result && y.chart.result[0] && y.chart.result[0].events && y.chart.result[0].events.dividends;
    if (!divs) return out;
    Object.keys(divs).forEach(function (k) {
      var e = divs[k];
      var rate = Number(e.amount);
      if (!isFinite(rate) || rate <= 0 || !e.date) return;
      var kind = asset.type === 'fii' ? 'rendimento' : 'dividendo';
      var dataCom = prevBusinessDay(ymd(new Date(e.date * 1000)));
      out.push({ ticker: asset.ticker, kind: kind, rate: rate, dataCom: dataCom, key: keyOf(asset.ticker, kind, dataCom, rate) });
    });
    return out;
  }
  // brapi (padrão)
  var token = (cfg.token || '').trim();
  if (!token && ['MXRF11', 'HGLG11'].indexOf(asset.ticker) < 0) return out;
  var path = asset.type === 'fii' ? 'fii' : 'stocks';
  var b = await getJSON('https://brapi.dev/api/v2/' + path + '/dividends?symbols=' + asset.ticker + '&startDate=' + ymd(start),
    token ? { Authorization: 'Bearer ' + token } : {});
  if (!b) return out;
  var list = [];
  var r = b.results && b.results[0];
  if (r && r.data && Array.isArray(r.data.cashDividends)) list = list.concat(r.data.cashDividends);
  if (r && r.dividendsData && Array.isArray(r.dividendsData.cashDividends)) list = list.concat(r.dividendsData.cashDividends);
  if (Array.isArray(b.dividends)) list = list.concat(b.dividends.filter(function (e) { return !e.symbol || String(e.symbol).toUpperCase() === asset.ticker; }));
  list.forEach(function (e) {
    var rate = Number(e.rate != null ? e.rate : e.value);
    if (!isFinite(rate) || rate <= 0) return;
    var kind = kindOf(e.label || e.type, asset.type);
    var dataCom = isoDate(e.lastDatePrior);
    out.push({ ticker: asset.ticker, kind: kind, rate: rate, dataCom: dataCom, paymentDate: isoDate(e.paymentDate), key: keyOf(asset.ticker, kind, dataCom, rate) });
  });
  return out;
}

function money(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }

addEventListener('saveConfig', function (resolve, reject, args) {
  try {
    var raw = args && args.config ? args.config : '{}';
    CapacitorKV.set(CONFIG_KEY, raw);
    var cfg = JSON.parse(raw);
    var seen = readJSON(SEEN_KEY, []);
    var merged = seen.concat((cfg.knownKeys || []).filter(function (k) { return seen.indexOf(k) < 0; }));
    CapacitorKV.set(SEEN_KEY, JSON.stringify(merged.slice(-2000)));
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener('checkDividends', async function (resolve, reject) {
  try {
    var cfg = readJSON(CONFIG_KEY, null);
    if (!cfg || !cfg.enabled || !cfg.assets || cfg.assets.length === 0) { resolve(); return; }
    var seen = readJSON(SEEN_KEY, []);
    var today = ymd(new Date());
    var notifications = [];
    for (var i = 0; i < cfg.assets.length; i++) {
      var asset = cfg.assets[i];
      var events;
      try { events = await fetchEvents(cfg, asset); } catch (e) { continue; }
      for (var j = 0; j < events.length; j++) {
        var ev = events[j];
        if (seen.indexOf(ev.key) >= 0) continue;
        seen.push(ev.key);
        var upcoming = ev.paymentDate ? ev.paymentDate >= today : !!ev.dataCom && ev.dataCom >= today;
        if (!upcoming) continue;
        var total = ev.rate * (asset.qty || 0) * (ev.kind === 'jcp' ? 0.85 : 1);
        notifications.push({
          id: Math.floor(Math.random() * 2000000000),
          title: 'Novo provento: ' + ev.ticker,
          body: (ev.kind === 'jcp' ? 'JCP' : ev.kind === 'rendimento' ? 'Rendimento' : 'Dividendo') +
            ' de ' + money(ev.rate) + ' por cota' + (total > 0 ? ' (≈ ' + money(total) + ' para você)' : '') +
            (ev.paymentDate ? '. Pagamento em ' + ev.paymentDate.split('-').reverse().join('/') : '') + '.',
          scheduleAt: new Date(Date.now() + 1000),
          channelId: 'dividendos',
          smallIcon: 'ic_stat_finance'
        });
      }
    }
    CapacitorKV.set(SEEN_KEY, JSON.stringify(seen.slice(-2000)));
    if (notifications.length > 0) CapacitorNotifications.schedule(notifications.slice(0, 5));
    resolve();
  } catch (e) {
    reject(e);
  }
});
