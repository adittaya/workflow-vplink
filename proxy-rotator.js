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

// Test proxy via HTTPS CONNECT (what Playwright/browsers use)
async function testProxy(proxy) {
  return new Promise((resolve) => {
    const start = Date.now();
    const done = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => done(null), 10000);
    try {
      // Step 1: CONNECT tunnel to httpbin.org:443
      const connReq = http.request({
        hostname: proxy.ip,
        port: proxy.port,
        method: 'CONNECT',
        path: 'httpbin.org:443',
        timeout: 8000,
      });
      connReq.on('connect', (res, socket) => {
        // Step 2: HTTPS request through the tunnel
        const opts = {
          socket,
          hostname: 'httpbin.org',
          path: '/ip',
          method: 'GET',
          headers: { 'Host': 'httpbin.org', 'User-Agent': 'curl/8.0' },
          timeout: 8000,
          rejectUnauthorized: false,
        };
        const tlsReq = https.request(opts, (tlsRes) => {
          let data = '';
          tlsRes.on('data', (chunk) => data += chunk);
          tlsRes.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json && json.origin) {
                done({ ...proxy, latency_ms: Date.now() - start, origin: json.origin });
              } else {
                done(null);
              }
            } catch { done(null); }
          });
        });
        tlsReq.on('error', () => done(null));
        tlsReq.on('timeout', () => { tlsReq.destroy(); done(null); });
        tlsReq.end();
      });
      connReq.on('error', () => done(null));
      connReq.on('timeout', () => { connReq.destroy(); done(null); });
      connReq.end();
    } catch { done(null); }
  });
}

async function filterAndClean(tier = 'premium', concurrency = 50) {
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

  if (results.dead.length > 0) {
    console.error(`  [Proxy] Deleting ${results.dead.length} dead proxies...`);
    // Batch delete dead proxies in parallel (25 at a time)
    for (let i = 0; i < results.dead.length; i += 25) {
      const batch = results.dead.slice(i, i + 25);
      await Promise.allSettled(batch.map(p => deleteProxy(p.ip, p.port)));
    }
    console.error(`  [Proxy] Deleted ${results.dead.length} dead proxies`);
  }

  console.error(`  [Proxy] ${results.working.length} working proxies available`);
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
  const proxies = await filterAndClean(tier);
  if (proxies.length === 0) {
    console.error('  [Proxy] No working proxies found');
    return null;
  }

  const history = config.loadProxyHistory();
  const picked = getRotationIndex(proxies, history);
  if (!picked) {
    console.error('  [Proxy] All proxies used in last 24h, recycling oldest');
    return proxies[Math.floor(Math.random() * proxies.length)];
  }

  console.error(`  [Proxy] Selected: ${picked.ip}:${picked.port} (${picked.latency_ms}ms)`);
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

// CLI: node proxy-rotator.js <tier> [--quick]
// Outputs: ip:port (on stdout), all status messages go to stderr
if (require.main === module) {
  const tier = process.argv[2] || 'premium';
  const quick = process.argv.includes('--quick');
  const fn = quick ? getProxyQuick : getProxy;
  fn(tier).then(p => {
    if (p) {
      console.log(`${p.ip}:${p.port}`);
    }
    process.exit(p ? 0 : 1);
  }).catch(e => {
    console.error('  [Proxy] Error:', e.message);
    process.exit(1);
  });
}

module.exports = { getProxy, getProxyQuick, filterAndClean, fetchProxies, testProxy };
