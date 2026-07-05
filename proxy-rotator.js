const config = require('./config');

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
  const url = `/proxy_results?select=ip,port,protocol,country,latency_ms&${field}=eq.true&order=latency_ms.asc&limit=500`;
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

async function testProxy(proxy) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const start = Date.now();
    const resp = await fetch('http://httpbin.org/ip', {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    const latency = Date.now() - start;
    return { ...proxy, latency_ms: latency, origin: data.origin };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

async function filterAndClean(tier = 'premium') {
  console.error('  [Proxy] Fetching proxies from Supabase...');
  const proxies = await fetchProxies(tier);
  console.error(`  [Proxy] Found ${proxies.length} ${tier} proxies`);

  const working = [];
  const dead = [];

  for (let i = 0; i < proxies.length; i++) {
    const p = proxies[i];
    process.stderr.write(`  [Proxy] Testing ${p.ip}:${p.port} (${i + 1}/${proxies.length})\r`);
    const result = await testProxy(p);
    if (result) {
      working.push(result);
    } else {
      dead.push(p);
    }
  }
  process.stderr.write('\n');

  if (dead.length > 0) {
    console.error(`  [Proxy] Deleting ${dead.length} dead proxies...`);
    for (const p of dead) {
      try { await deleteProxy(p.ip, p.port); } catch {}
    }
  }

  console.error(`  [Proxy] ${working.length} working proxies available`);
  return working;
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
