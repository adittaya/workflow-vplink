const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.vplink3.0');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const PROXY_HISTORY_PATH = path.join(CONFIG_DIR, 'proxy_history.json');

const DEFAULTS = {
  supabase_url: '',
  supabase_key: '',
  supabase_secret: '',
  proxy_enabled: false,
  proxy_tier: 'premium',
  youtube_traffic: false,
  mobile_profile: false,
  random_urls: [],
  vnc_port: 5900,
  views: 1,
};

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(config) {
  ensureDir();
  const existing = load();
  const merged = { ...existing, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function loadProxyHistory() {
  try {
    const raw = fs.readFileSync(PROXY_HISTORY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { used: [] };
  }
}

function saveProxyHistory(history) {
  ensureDir();
  fs.writeFileSync(PROXY_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

function isConfigured() {
  const cfg = load();
  return !!(cfg.supabase_url && cfg.supabase_key);
}

// CLI mode: node config.js --get <key> or --set <key> <value>
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--get') {
    const cfg = load();
    console.log(cfg[args[1]] !== undefined ? cfg[args[1]] : '');
  } else if (args[0] === '--set') {
    const key = args[1];
    let val = args.slice(2).join(' ');
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (!isNaN(val) && val !== '') val = Number(val);
    save({ [key]: val });
  } else if (args[0] === '--check') {
    console.log(isConfigured() ? 'configured' : 'unconfigured');
  } else if (args.length === 0) {
    console.log(JSON.stringify(load(), null, 2));
  }
}

module.exports = { load, save, loadProxyHistory, saveProxyHistory, isConfigured };
