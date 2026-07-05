const config = require('./config');
const http = require('http');
const https = require('https');

const SUPABASE_REST = '/rest/v1';

function supabaseFetch(endpoint, options = {}) {
  const cfg = config.load();
  const url = `${cfg.supabase_url}${SUPABASE_REST}${endpoint}`;
  const headers = {
    'apikey': cfg.supabase_secret || cfg.supabase_key,
    'Authorization': `Bearer ${cfg.supabase_secret || cfg.supabase_key}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  return fetch(url, { ...options, headers });
}

async function fetchProxies(tier = 'premium') {
  const field = tier === 'premium' ? 'vplink_ok' : 'e2_ok';
  const url = `/proxy_results?select=ip,port,proto,country,latency_ms&${field}=eq.true&order=latency_ms.asc&limit=500`;
  const resp = await supabaseFetch(url);
  if (!resp.ok) {
    throw new Error(`Supabase query failed: ${resp.status} ${await resp.text().catch(() => '')}`);
  }
  return resp.json();
}

async function deleteProxy(ip, port) {
  const url = `/proxy_results?ip=eq.${encodeURIComponent(ip)}&port=eq.${port}`;
  const resp = await supabaseFetch(url, { method: 'DELETE' });
  return resp.ok;
}

// Test proxy — tries HTTPS CONNECT first, falls back to HTTP absolute-form URI
const TEST_TARGETS = [
  { host: 'httpbin.org', path: '/ip', responseJson: true },
  { host: 'example.com', path: '/', responseJson: false },
];

async function testProxy(proxy) {
  const start = Date.now();
  const result = { ...proxy, latency_ms: 0, origin: '', speed_kbps: 0 };

  // Try each target until one works (proxies often block specific sites like httpbin.org)
  for (const target of TEST_TARGETS) {
    // Try HTTPS CONNECT
    let origin = await tryConnect(proxy, target);
    // Fall back to HTTP absolute-form
    if (!origin) origin = await tryHttp(proxy, target);
    if (origin) {
      result.origin = origin;
      result.latency_ms = Date.now() - start;
      // Speed test: download 100KB via HTTP proxy
      try {
        const speedStart = Date.now();
        const resp = await new Promise((resolve) => {
          const req = http.request({
            hostname: proxy.ip, port: proxy.port,
            path: 'http://speedtest.tele2.net/100KB.zip', method: 'GET',
            headers: { 'Host': 'speedtest.tele2.net' }, timeout: 10000,
          }, (res) => {
            res.on('error', () => resolve(0));
            let total = 0;
            res.on('data', (chunk) => total += chunk.length);
            res.on('end', () => resolve(total));
          });
          req.on('error', () => resolve(0));
          req.on('timeout', () => { req.destroy(); resolve(0); });
          req.end();
        });
        const speedTime = (Date.now() - speedStart) / 1000;
        result.speed_kbps = speedTime > 0 ? Math.round(resp / speedTime / 1024) : 0;
      } catch {}
      return result;
    }
  }
  return null;
}

function tryConnect(proxy, target) {
  return new Promise((resolve) => {
    const connReq = http.request({
      hostname: proxy.ip, port: proxy.port,
      method: 'CONNECT', path: target.host + ':443',
      timeout: 8000,
    });
    connReq.on('connect', (res, socket) => {
      socket.on('error', () => resolve(null));
      socket.on('timeout', () => { socket.destroy(); resolve(null); });
      socket.setTimeout(10000);
      const tlsReq = https.request({
        socket, hostname: target.host, path: target.path,
        method: 'GET', headers: { 'Host': target.host },
        timeout: 6000, rejectUnauthorized: false,
      }, (tlsRes) => {
        let data = '';
        tlsRes.on('data', (chunk) => data += chunk);
        tlsRes.on('end', () => {
          if (target.responseJson) {
            try { const json = JSON.parse(data); resolve(json && json.origin ? json.origin : null); }
            catch { resolve(null); }
          } else {
            // For non-JSON targets (e.g., example.com), any 2xx response means it worked
            resolve(tlsRes.statusCode >= 200 && tlsRes.statusCode < 300 ? target.host : null);
          }
        });
      });
      tlsReq.on('error', () => resolve(null));
      tlsReq.on('timeout', () => { tlsReq.destroy(); resolve(null); });
      tlsReq.end();
    });
    connReq.on('response', (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(null));
    });
    connReq.on('error', () => resolve(null));
    connReq.on('timeout', () => { connReq.destroy(); resolve(null); });
    connReq.end();
  });
}

function tryHttp(proxy, target) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: proxy.ip, port: proxy.port,
      path: 'http://' + target.host + target.path, method: 'GET',
      headers: { 'Host': target.host }, timeout: 8000,
    }, (res) => {
      res.on('error', () => resolve(null));
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (target.responseJson) {
          try { const json = JSON.parse(data); resolve(json && json.origin ? json.origin : null); }
          catch { resolve(null); }
        } else {
          resolve(res.statusCode >= 200 && res.statusCode < 300 ? target.host : null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function filterAndClean(tier = 'premium', concurrency = 50, deleteDead = false) {
  console.error('  [Proxy] Fetching proxies from Supabase...');
  const proxies = await fetchProxies(tier);
  console.error(`  [Proxy] Found ${proxies.length} ${tier} proxies`);

  const results = { working: [], dead: [] };
  let completed = 0;

  // Test proxies in parallel batches
  for (let i = 0; i < proxies.length; i += concurrency) {
    const batch = proxies.slice(i, i + concurrency);
    const outcomes = await Promise.allSettled(batch.map(p => testProxy(p)));
    for (let j = 0; j < batch.length; j++) {
      const result = outcomes[j].status === 'fulfilled' ? outcomes[j].value : null;
      if (result) {
        results.working.push(result);
      } else {
        results.dead.push(batch[j]);
      }
    }
    completed += batch.length;
    process.stderr.write(`  [Proxy] Tested ${completed}/${proxies.length} (${results.working.length} working)\r`);
  }
  process.stderr.write('\n');

  if (deleteDead && results.dead.length > 0) {
    console.error(`  [Proxy] Deleting ${results.dead.length} dead proxies...`);
    for (let i = 0; i < results.dead.length; i += 50) {
      const batch = results.dead.slice(i, i + 50);
      await Promise.allSettled(batch.map(p => deleteProxy(p.ip, p.port)));
    }
    console.error(`  [Proxy] Deleted ${results.dead.length} dead proxies`);
  }

  console.error(`  [Proxy] ${results.working.length} working proxies available`);
  if (results.working.length > 0) {
    // Show speed breakdown
    const fast = results.working.filter(p => p.speed_kbps >= 100).length;
    const medium = results.working.filter(p => p.speed_kbps >= 50 && p.speed_kbps < 100).length;
    const slow = results.working.filter(p => p.speed_kbps > 0 && p.speed_kbps < 50).length;
    const untested = results.working.filter(p => !p.speed_kbps).length;
    console.error(`  [Proxy] Speed: ${fast} fast, ${medium} medium, ${slow} slow, ${untested} untested`);
  }
  return results.working;
}

function getRotationIndex(proxies, history) {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const recent = new Set(
    history.used.filter(e => e.timestamp > cutoff).map(e => `${e.ip}:${e.port}`)
  );

  const available = proxies.filter(p => !recent.has(`${p.ip}:${p.port}`));
  if (available.length === 0) return null;

  const picked = available[Math.floor(Math.random() * available.length)];

  history.used.push({ ip: picked.ip, port: picked.port, timestamp: now });
  history.used = history.used.filter(e => e.timestamp > cutoff);
  config.saveProxyHistory(history);

  return picked;
}

async function getProxy(tier = 'premium') {
  const proxies = await filterAndClean(tier, 50, true); // auto-delete dead proxies
  if (proxies.length === 0) {
    console.error('  [Proxy] No working proxies found');
    return null;
  }

  // Filter out low-quality proxies — require latency < 5s
  const usable = proxies.filter(p => p.latency_ms && p.latency_ms < 5000);
  if (usable.length === 0) {
    console.error(`  [Proxy] All ${proxies.length} proxies are too slow, taking the fastest anyway`);
  }
  const pool = usable.length > 0 ? usable : proxies;

  // Sort: faster proxies first, lower latency as tiebreaker
  pool.sort((a, b) => {
    const aSpeed = a.speed_kbps || 0;
    const bSpeed = b.speed_kbps || 0;
    if (bSpeed !== aSpeed) return bSpeed - aSpeed;
    return (a.latency_ms || 9999) - (b.latency_ms || 9999);
  });

  // Random pick from top 30% (weighted toward faster proxies)
  const topN = Math.max(1, Math.ceil(pool.length * 0.3));
  const shortlist = pool.slice(0, topN);

  const history = config.loadProxyHistory();
  const picked = getRotationIndex(shortlist, history);
  if (!picked) {
    console.error('  [Proxy] All proxies used in last 24h, recycling oldest');
    const fallback = shortlist[Math.floor(Math.random() * Math.min(shortlist.length, 5))];
    console.error(`  [Proxy] Selected: ${fallback.ip}:${fallback.port} (${fallback.speed_kbps || '?'} KB/s, ${fallback.latency_ms}ms)`);
    return fallback;
  }

  console.error(`  [Proxy] Selected: ${picked.ip}:${picked.port} (${picked.speed_kbps || '?'} KB/s, ${picked.latency_ms}ms)`);
  return picked;
}

async function getProxyQuick(tier = 'premium') {
  const proxies = await fetchProxies(tier);
  if (proxies.length === 0) return null;

  const history = config.loadProxyHistory();
  const picked = getRotationIndex(proxies, history);
  if (!picked) {
    const p = proxies[Math.floor(Math.random() * proxies.length)];
    return p;
  }
  return picked;
}

// CLI: node proxy-rotator.js <tier> [--quick|--purge]
// --quick: fetch without live test (use DB status only)
// --purge: test AND delete dead proxies from database
// Outputs: ip:port (on stdout), all status messages go to stderr
if (require.main === module) {
  const tier = process.argv[2] || 'premium';
  const purge = process.argv.includes('--purge');
  const quick = process.argv.includes('--quick') || process.argv.includes('--purge');

  if (purge) {
    // Full test + delete dead proxies
    filterAndClean(tier, 50, true).then(working => {
      if (working.length > 0) {
        working.sort((a, b) => (b.speed_kbps || 0) - (a.speed_kbps || 0) || (a.latency_ms || 9999) - (b.latency_ms || 9999));
        console.log(`${working[0].ip}:${working[0].port}`);
        console.error(`  [Proxy] Best: ${working[0].ip}:${working[0].port} (${working[0].speed_kbps || '?'} KB/s, ${working[0].latency_ms}ms)`);
      }
      process.exit(working.length > 0 ? 0 : 1);
    }).catch(e => { console.error('  [Proxy] Error:', e.message); process.exit(1); });
  } else {
    const fn = quick ? getProxyQuick : getProxy;
    fn(tier).then(p => {
      if (p) console.log(`${p.ip}:${p.port}`);
      process.exit(p ? 0 : 1);
    }).catch(e => { console.error('  [Proxy] Error:', e.message); process.exit(1); });
  }
}

module.exports = { getProxy, getProxyQuick, filterAndClean, fetchProxies, testProxy };
