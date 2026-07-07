let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const fs = require('fs');
const path = require('path');

const DEBUG = process.argv.includes('--vplink-debug') || process.env.VPLINK_DEBUG === '1';
if (DEBUG) console.log('  [debug mode active]');

let browser;
let debugPage = null;
let debugShot = async (label) => {
  if (!DEBUG) return;
  const p = debugPage;
  if (!p) return;
  const dir = path.join(__dirname, 'screenshots');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  try {
    await p.screenshot({ path: path.join(dir, `${label}.png`), fullPage: false });
  } catch {}
  try {
    const html = await p.evaluate(() => document.documentElement.outerHTML).catch(() => '');
    fs.writeFileSync(path.join(dir, `${label}.html`), html);
  } catch {}
};
process.on('SIGINT', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(130);
});

(async () => {
  const KEY = process.argv[2] || process.env.VPLINK_KEY;
  if (!KEY) { console.error('Usage: node automation.js <vplink_key>'); process.exit(1); }

  // Clean up old artifacts from previous runs
  const cleanupDirs = ['.'];
  const cleanupGlobs = [
    { match: 'destination_url', isDir: false },
    { match: 'debug_', isDir: false },
    { match: 'events', isDir: false },
    { match: 'summary.json', isDir: false },
    { match: 'screen_recording', isDir: false },
    { match: 'recording_', isDir: false },
    { match: 'record.js', isDir: false },
    { match: 'record.sh', isDir: false },
  ];
  for (const dir of cleanupDirs) {
    const fullDir = path.join(__dirname, dir);
    try {
      const entries = fs.readdirSync(fullDir);
      for (const e of entries) {
        for (const g of cleanupGlobs) {
          if (e.startsWith(g.match)) {
            const fp = path.join(fullDir, e);
            try {
              if (g.isDir) fs.rmSync(fp, { recursive: true, force: true });
              else if (fs.statSync(fp).isFile()) fs.unlinkSync(fp);
            } catch {}
            break;
          }
        }
      }
    } catch {}
  }
  // Clean screenshots directory
  try { fs.rmSync(path.join(__dirname, 'screenshots'), { recursive: true, force: true }); } catch {}

  const stealthArgs = ['--no-sandbox', '--disable-gpu', '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-setuid-sandbox',
    '--disable-automation'];
  const launchOpts = {};
  if (process.env.VPLINK_TERMUX === '1') {
    launchOpts.headless = true;
    launchOpts.executablePath = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
    launchOpts.args = [...stealthArgs];
  } else {
    launchOpts.headless = false;
    launchOpts.args = [...stealthArgs];
  }
  if (process.env.VPLINK_PROXY) {
    launchOpts.args.push(`--proxy-server=${process.env.VPLINK_PROXY}`);
  }
  if (process.env.VPLINK_EXTRA_ARGS) {
    launchOpts.args.push(...process.env.VPLINK_EXTRA_ARGS.split(' '));
  }

  browser = await chromium.launch(launchOpts);
  const ctxOpts = { viewport: { width: 1280, height: 720 } };
  if (process.env.VPLINK_USER_AGENT) ctxOpts.userAgent = process.env.VPLINK_USER_AGENT;
  if (process.env.VPLINK_VIEWPORT_WIDTH || process.env.VPLINK_VIEWPORT_HEIGHT) {
    ctxOpts.viewport = {
      width: parseInt(process.env.VPLINK_VIEWPORT_WIDTH) || 1280,
      height: parseInt(process.env.VPLINK_VIEWPORT_HEIGHT) || 720,
    };
  }
  ctxOpts.locale = 'en-US';
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  debugPage = page;
  page.setDefaultNavigationTimeout(60000);

  // Stealth: spoof common automation detection vectors
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = p => p.name === 'notifications' ? Promise.resolve({ state: 'denied' }) : origQuery(p);
  });

  // Log wistfulseverely API calls for conversion tracking diagnostics
  page.on('request', req => {
    if (req.url().includes('wistfulseverely.com')) {
      console.log(`  [wistfulseverely] ${req.method()} ${req.url().substring(0, 100)}`);
    }
    if (req.url().includes('vplink.in') && req.url().includes('/api/')) {
      console.log(`  [vplink-api] ${req.method()} ${req.url().substring(0, 100)}`);
    }
  });
  page.on('response', res => {
    if (res.url().includes('wistfulseverely.com')) {
      const loc = res.headers()['location'] || '';
      console.log(`  [wistfulseverely] response ${res.status()} ${res.url().substring(0, 100)}${loc ? ' → ' + loc.substring(0, 80) : ''}`);
    }
    if (res.status() === 200 && (res.url().includes('facebook.com/tr/') || res.url().includes('adscool.net/pageview/') || res.url().includes('wistfulseverely.com'))) {
      wistfulTrackingDone = true;
    }
    // Log tracking chain responses (non-wistfulseverely) that are part of the redirect chain
    if (res.status() >= 300 && res.status() < 400 && !res.url().includes('wistfulseverely.com')) {
      const loc = res.headers()['location'] || '';
      console.log(`  [redirect] ${res.status()} ${res.url().substring(0, 80)}${loc ? ' → ' + loc.substring(0, 80) : ''}`);
    }
    if (res.status() === 200 && !res.url().includes('vplink.in') && !res.url().includes('wistfulseverely.com')) {
      if (res.url().includes('facebook.com') || res.url().includes('adscool') || res.url().includes('google')) {
        console.log(`  [tracking] ${res.status()} ${res.url().substring(0, 100)}`);
      }
    }
  });

  let destinationUrl = null;
  let wistfulTrackingDone = false;
  let vplinkArrivedAt = Date.now();  // timestamp when we first landed on vplink.in
  const ms = async t => { try { await page.waitForTimeout(t); } catch {} };
  const safeURL = () => { try { return page.url(); } catch { return ''; } };
  const safeEval = (fn, ...args) => { try { return page.evaluate(fn, ...args).catch(() => null); } catch { return null; } };
  // Wait for vplink.in JS auto-redirect to settle (up to 15s)
  const waitRedirect = async () => {
    for (let i = 0; i < 15; i++) {
      if (!safeURL().includes('vplink.in')) break;
      await ms(1000);
    }
  };

  const clickEl = async sel => {
    try {
      await page.click(sel, { timeout: 5000 });
      return true;
    } catch {
      try {
        return await page.evaluate(s => {
          const el = document.querySelector(s);
          if (!el) return false;
          el.scrollIntoView({ block: 'center' });
          el.click();
          return true;
        }, sel);
      } catch { return false; }
    }
  };

  const clickText = async txt => {
    try {
      await page.locator(`text=${txt}`).first().click({ timeout: 5000 });
      return true;
    } catch {
      try {
        return await page.evaluate(t => {
          const walker = document.createTreeWalker(document.body, 4, null, false);
          let n; while (n = walker.nextNode()) {
            if (n.textContent.trim().toLowerCase() === t.toLowerCase()) {
              n.parentElement?.scrollIntoView({ block: 'center' });
              n.parentElement?.click();
              return true;
            }
          }
          return false;
        }, txt);
      } catch { return false; }
    }
  };

  const DEST_PATTERNS = ['wistfulseverely.com/api/', '12indiaplay.com', 'vv53243', 'casino', 'one-',
    'apkmirror.com', 'play.google.com', 'download', '.apk'];

  const knownInter = ['vplink.in', 'onlinewish', 'krishitalk', 'learn_more', 'studydegree', 'studyblog',
    'jobskiki', 'educatehub', 'studyeducates', 'wistfulseverely.com'];

  const isDestination = url => {
    if (!url || !url.startsWith('http')) return false;
    if (url.includes('chrome-error') || url.includes('about:blank')) return false;
    for (const p of DEST_PATTERNS) {
      if (url.includes(p)) return true;
    }
    for (const k of knownInter) {
      if (url.includes(k)) return false;
    }
    // Catch-all: any unknown domain is a potential destination
    // False positives prevented by URL stability check in doGetLink
    return true;
  };


  // ── Get Link ──
  const doGetLink = async () => {
    try {
      // Close any leftover tabs from previous failed attempts
      const pages = context.pages();
      for (const p of pages) {
        if (p !== page) { try { await p.close(); } catch {} }
      }

      const btn = await page.waitForSelector('#get-link', { timeout: 35000 }).catch(() => null);
      if (!btn) return false;

      // Wait for any visible countdown timer elements to finish
      const timerSelectors = ['#tp-wait1', '#ce-wait1', '#tp-time', '#ce-time',
        '[class*="timer"]', '[id*="timer"]', '[class*="countdown"]', '[id*="countdown"]'];
      for (const sel of timerSelectors) {
        try {
          await page.waitForSelector(sel, { state: 'hidden', timeout: 1000 }).catch(() => {});
        } catch {}
      }

      // Wait for disabled class to be removed (countdown finished)
      {
        const t0 = Date.now();
        await page.waitForFunction(() => {
          const el = document.getElementById('get-link');
          return el && !el.classList.contains('disabled');
        }, { timeout: 30000 });
        const elapsed = Date.now() - t0;
        if (elapsed > 500) console.log(`  countdown: ${elapsed}ms`);
      }
      await ms(500);

      if (DEBUG) await debugShot('06-before-getlink-click');

      // Reset tracking flag before click (responses after this point are tracking)
      wistfulTrackingDone = false;

      console.log('  clicking Get Link');
      const newTabPromise = context.waitForEvent('page', { timeout: 30000 }).catch(() => null);

      await clickEl('#get-link');

      let newTab = await newTabPromise;
      if (DEBUG) await debugShot('07-after-getlink-click');

      const getLinkClickTime = Date.now();
      console.log('  waiting for destination...');
      let stableUrl = null;
      let stableCount = 0;

      for (let i = 0; i < 60; i++) {
        await ms(1000);

        // Get current URL — prefer new tab (it contains the real destination)
        let currentUrl = '';
        if (newTab) {
          try {
            // Wait for page to finish loading before reading URL
            await newTab.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            currentUrl = newTab.url();
          } catch {
            newTab = null;
          }
        }
        if (!currentUrl || currentUrl.includes('about:blank')) {
          const u = safeURL();
          if (u && !u.includes('about:blank')) currentUrl = u;
        }
        if (!currentUrl || currentUrl.includes('chrome-error') || currentUrl.includes('about:blank'))
          continue;

        // Stability: require 3 consecutive same-URL observations
        // This filters out intermediate tracking redirects
        if (currentUrl === stableUrl) {
          stableCount++;
          if (stableCount >= 3 && isDestination(currentUrl)) {
            destinationUrl = currentUrl;
            if (DEBUG) await debugShot('08-destination-found');
            // Keep browser alive minimum 30s from Get Link click
            // for wistfulseverely conversion confirmation chain
            // (5-7 redirect hops through slow proxies can take 15-25s)
            {
              const elapsed = Date.now() - getLinkClickTime;
              const remaining = Math.max(0, 30000 - elapsed);
              if (remaining > 500) {
                console.log(`  tracking wait: ${remaining}ms (${elapsed}ms since click)`);
                const mainUrlLog = await page.evaluate(() => window.location.href).catch(() => 'N/A');
                console.log(`  main page URL: ${mainUrlLog.substring(0, 100)}`);
                await ms(remaining);
                const mainUrlEnd = await page.evaluate(() => window.location.href).catch(() => 'N/A');
                console.log(`  after wait URL: ${mainUrlEnd.substring(0, 100)}`);
              }
            }
            return true;
          }
        } else {
          stableUrl = currentUrl;
          stableCount = 1;
        }
      }
    } catch {}
    return false;
  };


  await debugShot('01-start');

  // ── Navigate ──
  console.log('=== Start funnel ===');
  const navTimeout = process.env.VPLINK_PROXY ? 90000 : 45000;
  try {
    await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  } catch {
    console.log('  retrying navigation...');
    await ms(2000);
    try {
      await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    } catch (e) {
      console.error('  navigation failed after retry:', e.message);
    }
  }
  vplinkArrivedAt = Date.now();
  await page.waitForLoadState('networkidle').catch(() => {});
  await debugShot('02-after-nav');
  await ms(2000);

  // Wait for possible auto-redirect
  await waitRedirect();
  await debugShot('03-after-redirect');

  // Wait for Cloudflare challenge to complete if present, then wait for #get-link or redirect
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!safeURL().includes('vplink.in') || safeURL().includes('cdn-cgi')) break;

    // Check if page is showing Cloudflare challenge (no #get-link + challenge HTML)
    const hasGl = await safeEval(() => !!document.getElementById('get-link'));
    if (hasGl) { console.log('  page loaded'); break; }

    const isCf = await safeEval(() => {
      const html = (document.documentElement?.innerHTML || '').substring(0, 2000);
      return html.includes('cf-browser-verification') || html.includes('challenge-form')
        || html.includes('cf-challenge') || html.includes('_cf_chl_opt');
    });

    if (isCf) console.log('  Cloudflare challenge detected, waiting...');

    // Wait for content to appear — poll #get-link and URL change
    console.log(`  waiting for page (attempt ${attempt + 1})...`);
    let loaded = false;
    for (let i = 0; i < 35; i++) {
      await ms(1000);
      if (!safeURL().includes('vplink.in')) { loaded = true; break; }
      if (await safeEval(() => !!document.getElementById('get-link'))) {
        console.log('  page loaded');
        loaded = true;
        break;
      }
    }
    if (loaded) break;

    // If still stuck on Cloudflare, try reloading
    if (isCf) {
      console.log('  Cloudflare challenge did not resolve, reloading...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await ms(3000);
      await waitRedirect();
    } else {
      console.log('  page not loaded, continuing...');
      break;
    }
  }

  let vplinkMisses = 0;

  // ── Main loop ──
  for (let cycle = 0; cycle < 30 && !destinationUrl; cycle++) {
    const url = safeURL();
    if (!url) { await ms(2000); continue; }
    console.log(`\n[${cycle + 1}] ${url.substring(0, 110)}`);

    if (isDestination(url)) { destinationUrl = url; break; }

    // ── vplink.in ──
    if (url.includes('vplink.in') && !url.includes('cdn-cgi')) {
      if (!vplinkArrivedAt) vplinkArrivedAt = Date.now();
      vplinkMisses++;
      const btnState = await safeEval(() => {
        const el = document.getElementById('get-link');
        if (!el) return 'missing';
        if (el.classList.contains('disabled')) return 'disabled';
        if (el.offsetParent === null) return 'hidden';
        return 'ready';
      });
      await debugShot(`04-vplink-cycle${cycle + 1}-${btnState}`);

      // Button ready → click (only once per session — retry reuses same token)
      if (btnState === 'ready') {
        if (await doGetLink()) break;
        console.log('  Get Link timeout — reloading');
        // Close leftover tabs and reload for a clean state
        const pages = context.pages();
        for (const p of pages) { if (p !== page) { try { await p.close(); } catch {} } }
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await ms(3000);
        continue;
      }

      // Button missing for 3+ cycles → force reload (next cycle re-checks btnState)
      if (btnState === 'missing') {
        if (vplinkMisses >= 3) {
          console.log('  #get-link missing for 3 cycles, reloading');
          await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
          await page.waitForLoadState('networkidle').catch(() => {});
          await ms(3000);
        } else {
          await ms(2000);
        }
        continue;
      }

      // Button exists but disabled/hidden (countdown still running) → wait
      await ms(2000);
      continue;
    }

    // ── Article page ──
    if (url.includes('onlinewish') || url.includes('krishitalk') || url.includes('learn_more')
        || url.includes('studydegree') || url.includes('studyblog') || url.includes('jobskiki')
        || url.includes('educatehub') || url.includes('studyeducates')) {
      console.log('  article — waiting 15s');
      const startUrl = safeURL();
      await ms(15000);

      const tried = new Set();
      while (safeURL() === startUrl) {
        await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});

        const btn = await safeEval(triedArr => {
          const v = el => el && el.offsetParent !== null
            && getComputedStyle(el).display !== 'none'
            && getComputedStyle(el).visibility !== 'hidden'
            && getComputedStyle(el).opacity !== '0'
            && !el.disabled;

          const checks = [
            '#tp-snp2', '#cross-snp2', '#btn6',
            '#btn7 > button', '#btn7',
            '#main > div:nth-child(4) > center > center > a',
          ];
          for (const sel of checks) {
            if (triedArr.includes(sel)) continue;
            const el = document.querySelector(sel);
            if (v(el)) return sel;
          }
          const te = document.querySelectorAll('a, button, span, div');
          for (const el of te) {
            const txt = el.textContent.trim().toLowerCase();
            if (txt !== 'verify' && txt !== 'continue') continue;
            if (triedArr.includes(txt)) continue;
            if (!v(el)) return txt;
          }
          return null;
        }, [...tried]);

        if (!btn) {
          console.log('  no more buttons');
          break;
        }

        console.log(`  clicking ${btn}`);
        if (btn === 'verify' || btn === 'continue') {
          await clickText(btn);
        } else {
          await clickEl(btn);
        }

        if (safeURL() !== startUrl) break;
        console.log('  waiting 15s after click');
        await ms(15000);

        if (safeURL() !== startUrl) break;
        tried.add(btn);
        console.log(`  ${btn} didn't navigate, trying next`);
      }

      if (safeURL() === startUrl) {
        console.log('  exhausted — force to vplink.in');
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await waitRedirect();
      }
      continue;
    }

    // ── Unknown / error — recover or wait ──
    if (url.startsWith('chrome-error://')) {
      console.log('  chrome-error — navigating to vplink.in');
      await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await ms(3000);
      await waitRedirect();
      continue;
    }
    for (let i = 0; i < 8; i++) {
      await ms(1000);
      const u = safeURL();
      if (u !== url) break;
    }
  }

  if (!destinationUrl) {
    // Final attempt: try up to 3 approaches
    console.log('  final attempt — getting destination');

    // 1. Search for vplink link on current page
    let gotDest = false;
    const vplinkHref = await safeEval(() => {
      const links = document.querySelectorAll('a[href*="vplink.in"]');
      for (const a of links) {
        if (a.href && !a.href.includes('cdn-cgi')) return a.href;
      }
      return null;
    });
    if (vplinkHref) {
      console.log('  found vplink link');
      await page.goto(vplinkHref, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      if (safeURL().includes('vplink.in')) gotDest = await doGetLink();
    }

    // 2. If on vplink.in, try Get Link
    if (!gotDest && safeURL().includes('vplink.in')) {
      gotDest = await doGetLink();
    }

    // 3. Direct goto vplink and try to catch Get Link before redirect
    if (!gotDest) {
      for (let attempt = 0; attempt < 3; attempt++) {
        console.log(`  direct attempt ${attempt + 1}`);
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        // Rapid poll for #get-link (redirect usually fires within 1-2s)
        for (let w = 0; w < 10; w++) {
          await ms(500);
          const cur = safeURL();
          if (cur.includes('vplink.in')) {
            const hasGl = await safeEval(() => !!document.getElementById('get-link'));
            if (hasGl && await doGetLink()) { gotDest = true; break; }
          } else break; // page redirected
        }
        if (gotDest) break;
      }
    }

    if (gotDest) destinationUrl = safeURL();
  }

  console.log('\n═════════════════════════════════════════');
  console.log('  ✅ DESTINATION URL:');
  console.log('  ' + (destinationUrl || 'N/A'));
  if (destinationUrl) fs.writeFileSync(path.join(__dirname, 'destination_url.txt'), destinationUrl);
  await ms(2000);
  await browser.close();
})();
