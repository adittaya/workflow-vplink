let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('playwright-core')); }
const fs = require('fs');
const path = require('path');

const KEY = process.argv[2] || process.env.VPLINK_KEY;
if (!KEY) { console.error('Usage: node automation.js <vplink_key>'); process.exit(1); }

const DEBUG = process.argv.includes('--vplink-debug') || process.env.VPLINK_DEBUG === '1';
let browser, context, page;
let destinationUrl = null;
let startTime = Date.now();

const log = msg => console.log(`  [${((Date.now()-startTime)/1000).toFixed(1)}s] ${msg}`);
const ms = t => new Promise(r => setTimeout(r, t));
const safeURL = () => { try { return page.url(); } catch { return ''; } };
const safeEval = (fn, ...a) => { try { return page.evaluate(fn, ...a).catch(() => null); } catch { return null; } };

process.on('SIGINT', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(130);
});

(async () => {
  // Clean old artifacts
  for (const pattern of ['destination_url', 'debug_', 'events', 'summary.json', 'screen_recording',
    'recording_', 'record.js', 'record.sh']) {
    try {
      const entries = fs.readdirSync(__dirname);
      for (const e of entries) {
        if (e.startsWith(pattern)) {
          const fp = path.join(__dirname, e);
          try { if (fs.statSync(fp).isFile()) fs.unlinkSync(fp); } catch {}
        }
      }
    } catch {}
  }
  try { fs.rmSync(path.join(__dirname, 'screenshots'), { recursive: true, force: true }); } catch {}

  // Launch browser
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
  if (process.env.VPLINK_PROXY) launchOpts.args.push(`--proxy-server=${process.env.VPLINK_PROXY}`);
  if (process.env.VPLINK_EXTRA_ARGS) launchOpts.args.push(...process.env.VPLINK_EXTRA_ARGS.split(' '));

  browser = await chromium.launch(launchOpts);
  const ctxOpts = { viewport: { width: 1280, height: 720 }, locale: 'en-US' };
  if (process.env.VPLINK_USER_AGENT) ctxOpts.userAgent = process.env.VPLINK_USER_AGENT;
  if (process.env.VPLINK_VIEWPORT_WIDTH || process.env.VPLINK_VIEWPORT_HEIGHT) {
    ctxOpts.viewport = {
      width: parseInt(process.env.VPLINK_VIEWPORT_WIDTH) || 1280,
      height: parseInt(process.env.VPLINK_VIEWPORT_HEIGHT) || 720,
    };
  }
  context = await browser.newContext(ctxOpts);
  page = await context.newPage();
  page.setDefaultNavigationTimeout(90000);

  // Debug screenshot helper
  let debugPage = page;
  const debugShot = async (label) => {
    if (!DEBUG) return;
    const dir = path.join(__dirname, 'screenshots');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    try { await debugPage.screenshot({ path: path.join(dir, `${label}.png`), fullPage: false }); } catch {}
  };

  // Stealth init
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
    const orig = window.navigator.permissions.query;
    window.navigator.permissions.query = p => p.name === 'notifications' ? Promise.resolve({ state: 'denied' }) : orig(p);
  });

  // Network logging
  page.on('request', req => {
    const u = req.url();
    if (u.includes('wistfulseverely.com')) log(`wistful ${req.method()} ${u.substring(0,100)}`);
    if (u.includes('vplink.in') && u.includes('/api/')) log(`vplink-api ${req.method()} ${u.substring(0,100)}`);
  });
  page.on('response', res => {
    const u = res.url();
    if (u.includes('wistfulseverely.com')) {
      const loc = res.headers()['location'] || '';
      log(`wistful ${res.status()} ${u.substring(0,70)}${loc ? ' → ' + loc.substring(0,70) : ''}`);
    }
    if (res.status() >= 300 && res.status() < 400 && !u.includes('wistfulseverely.com') && !u.includes('doubleclick') && !u.includes('google')) {
      const loc = res.headers()['location'] || '';
      if (loc) log(`redirect ${res.status()} ${u.substring(0,60)} → ${loc.substring(0,70)}`);
    }
  });
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('vplink') || t.includes('visitor') || t.includes('partner') || t.includes('click') || t.includes('error'))
      log(`console: ${t.substring(0,120)}`);
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) log(`nav: ${frame.url()}`);
  });
  page.on('popup', popup => {
    log(`popup opened: ${popup.url().substring(0,100)}`);
  });

  // Helpers
  const clickEl = async sel => {
    try { await page.click(sel, { timeout: 5000 }); return true; }
    catch {
      try { return await page.evaluate(s => { const el = document.querySelector(s); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; }, sel); }
      catch { return false; }
    }
  };

  const clickText = async txt => {
    try { await page.locator(`text=${txt}`).first().click({ timeout: 5000 }); return true; }
    catch { return false; }
  };

  const DEST_PATTERNS = ['12indiaplay.com', 'vv53243', 'casino', 'one-',
    'apkmirror.com', 'play.google.com', 'download', '.apk', 'one-vv'];

  const isDestination = url => {
    if (!url || !url.startsWith('http')) return false;
    if (url.includes('chrome-error') || url.includes('about:blank')) return false;
    for (const p of DEST_PATTERNS) {
      if (url.includes(p)) return true;
    }
    return false;
  };

  // ── Get Link handler ──
  const doGetLink = async () => {
    try {
      // Close leftover popups
      for (const p of context.pages()) {
        if (p !== page) { try { await p.close(); } catch {} }
      }

      const btn = await page.waitForSelector('#get-link', { timeout: 40000 }).catch(() => null);
      if (!btn) return false;

      // Capture href before clicking (reliable fallback when popup fails)
      const linkHref = await btn.evaluate(el => el.href).catch(() => '');

      // Wait for countdown completion (disabled class removal)
      const t0 = Date.now();
      try {
        await page.waitForFunction(() => {
          const el = document.getElementById('get-link');
          return el && !el.classList.contains('disabled');
        }, { timeout: 35000 });
      } catch {}
      const countdownElapsed = Date.now() - t0;
      if (countdownElapsed > 500) log(`get-link countdown: ${countdownElapsed}ms`);
      await ms(1000);

      log('clicking Get Link');
      const newTabPromise = context.waitForEvent('page', { timeout: 20000 }).catch(() => null);
      await clickEl('#get-link');
      let newTab = await newTabPromise;

      const clickTime = Date.now();
      let stableUrl = '', stableCount = 0;

      // Poll for destination URL — check main page + popup
      for (let i = 0; i < 60; i++) {
        await ms(1000);
        let popupUrl = '';

        // Check popup first — if it has a real URL, it IS the destination
        if (newTab) {
          try {
            await newTab.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
            popupUrl = newTab.url();
          } catch { newTab = null; }
          if (popupUrl && !popupUrl.includes('about:blank') && !popupUrl.includes('chrome-error')) {
            destinationUrl = popupUrl;
            log(`destination (popup): ${popupUrl.substring(0,100)}`);
            const elapsed = Date.now() - clickTime;
            const wait = Math.max(0, 25000 - elapsed);
            if (wait > 500) { log(`tracking wait: ${wait}ms`); await ms(wait); }
            return true;
          }
        }

        // Fallback to main page URL (popup failed or still loading)
        const mUrl = safeURL();
        if (!mUrl || mUrl.includes('about:blank') || mUrl.includes('chrome-error')) continue;

        // Stability + pattern check for main page (filters wistfulseverely tracking URLs)
        if (mUrl === stableUrl) {
          stableCount++;
          if (stableCount >= 3 && isDestination(mUrl)) {
            destinationUrl = mUrl;
            log(`destination (stable): ${mUrl.substring(0,100)}`);
            const elapsed = Date.now() - clickTime;
            const wait = Math.max(0, 25000 - elapsed);
            if (wait > 500) { log(`tracking wait: ${wait}ms`); await ms(wait); }
            return true;
          }
        } else {
          stableUrl = mUrl;
          stableCount = 1;
        }
      }

      // After loop: href fallback (captured before click)
      if (linkHref && linkHref.startsWith('http')) {
        destinationUrl = linkHref;
        log(`destination (href): ${linkHref.substring(0,100)}`);
        const elapsed = Date.now() - clickTime;
        const wait = Math.max(0, 25000 - elapsed);
        if (wait > 500) { log(`tracking wait: ${wait}ms`); await ms(wait); }
        return true;
      }
    } catch {}
    return false;
  };

  // ── Article page handler ──
  const handleArticle = async () => {
    log('article page');
    await debugShot('article-start');
    const startUrl = safeURL();

    // Wait for page to settle after initial load
    await ms(3000);

    const tried = new Set();
    const maxIterations = 30;

    for (let iter = 0; iter < maxIterations; iter++) {
      const currentUrl = safeURL();
      if (currentUrl !== startUrl) { log('page navigated, exiting article'); return true; }

      // Scroll to trigger lazy-loaded elements
      await safeEval(() => window.scrollBy(0, 300));

      // Priority button detection
      const btn = await safeEval((triedArr, popupSels, normalSels) => {
        const visible = el => el && el.getClientRects().length > 0
          && getComputedStyle(el).display !== 'none'
          && getComputedStyle(el).visibility !== 'hidden'
          && getComputedStyle(el).opacity !== '0'
          && !el.disabled;

        // Popup selectors — always check, never skipped (popup can reappear)
        for (const sel of popupSels) {
          const el = document.querySelector(sel);
          if (visible(el)) return `__popup__${sel}`;
        }

        // Normal selectors — skip tried
        for (const sel of normalSels) {
          if (triedArr.includes(sel)) continue;
          const el = document.querySelector(sel);
          if (visible(el)) return `__normal__${sel}`;
        }

        // Text-based detection — skip tried
        const texts = ['verify', 'continue', 'get link'];
        const allEls = document.querySelectorAll('a, button, span, div, input');
        for (const el of allEls) {
          const txt = (el.textContent || '').trim().toLowerCase();
          if (!texts.includes(txt)) continue;
          if (triedArr.includes(txt)) continue;
          if (visible(el)) return `__text__${txt}`;
        }

        return null;
      }, [...tried],
        ['#continueBtn', '#adOverlay button'],
        ['#tp-snp2', '#cross-snp2', '#btn6', '#btn7 > button', '#btn7',
          '#tp-generate a', '#ce-generate a', '#main > div:nth-child(4) > center > center > a']);

      if (!btn) {
        log('no buttons yet — waiting for popup (up to 60s)...');
        let popupFound = false;
        for (let w = 0; w < 60; w++) {
          await ms(1000);
          if (safeURL() !== startUrl) { log('auto-redirect detected'); return true; }
          const foundSel = await safeEval(() => {
            for (const sel of ['#continueBtn', '#adOverlay button']) {
              const el = document.querySelector(sel);
              if (el && el.getClientRects().length > 0) return sel;
            }
            return '';
          });
          if (foundSel) {
            popupFound = true;
            log('popup appeared after ' + (w + 1) + 's, clicking ' + foundSel);
            // Force-click bypasses CSS animation stability check (pulse 2s infinite)
            await page.locator(foundSel).click({ force: true, timeout: 5000 }).catch(() => clickEl(foundSel));
            for (let nw = 0; nw < 30; nw++) {
              await ms(1000);
              if (safeURL() !== startUrl) { log('navigated after popup click'); return true; }
            }
            log('popup click did not navigate, marking tried');
            tried.add(foundSel);
            break;
          }
          if (w % 5 === 0) await safeEval(() => window.scrollBy(0, 200));
        }
        if (!popupFound) break;
        continue;
      }

      // Parse the tagged return value: __type__value
      const us = btn.indexOf('__', 2);
      const btnType = us > 0 ? btn.substring(2, us) : 'normal';
      const btnValue = us > 0 ? btn.substring(us + 2) : btn;

      log(`clicking: ${btnValue}`);
      if (btnType === 'popup') {
        await page.locator(btnValue).click({ force: true, timeout: 5000 }).catch(() => clickEl(btnValue));
      } else if (btnType === 'text') {
        await clickText(btnValue);
      } else {
        await clickEl(btnValue);
      }

      // Wait for navigation or countdown
      for (let w = 0; w < 30; w++) {
        await ms(1000);
        if (safeURL() !== startUrl) { log('navigated after click'); return true; }
      }

      // Only mark non-popup buttons as tried (popup can reappear)
      if (btnType !== 'popup') tried.add(btnValue);
      log(`${btnValue} didn't navigate, trying next`);
    }

    return false;
  };

  // ── Main flow ──
  log('='.repeat(50));
  log(`starting funnel for KEY=${KEY}`);
  if (DEBUG) log('debug mode active');
  const navTimeout = process.env.VPLINK_PROXY ? 90000 : 45000;

  // Navigate to vplink.in
  log(`navigating to vplink.in/${KEY}`);
  await debugShot('01-start');
  try {
    await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  } catch (e) {
    log(`first goto failed: ${e.message}, retrying...`);
    await ms(2000);
    try {
      await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    } catch (e2) {
      log(`second goto failed: ${e2.message}`);
    }
  }
  await ms(2000);
  await debugShot('02-after-nav');

  // Wait for auto-redirect (vplink.in JS redirects to article page)
  log('waiting for auto-redirect...');
  for (let i = 0; i < 30; i++) {
    await ms(1000);
    if (!safeURL().includes('vplink.in')) break;
  }
  await debugShot('03-after-redirect');

  // Handle Cloudflare challenge if still on vplink.in
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = safeURL();
    if (!url.includes('vplink.in') || url.includes('cdn-cgi')) break;

    const hasGl = await safeEval(() => !!document.getElementById('get-link'));
    if (hasGl) { log('page loaded (get-link visible)'); break; }

    const isCf = await safeEval(() => {
      const html = (document.documentElement?.innerHTML || '').substring(0, 2000);
      return html.includes('cf-browser-verification') || html.includes('challenge-form')
        || html.includes('cf-challenge') || html.includes('_cf_chl_opt');
    });

    if (isCf) log('Cloudflare challenge detected');
    log(`waiting for page content (attempt ${attempt + 1})...`);

    let loaded = false;
    for (let i = 0; i < 40; i++) {
      await ms(1000);
      if (!safeURL().includes('vplink.in')) { loaded = true; break; }
      if (await safeEval(() => !!document.getElementById('get-link'))) { loaded = true; break; }
    }
    if (loaded) break;

    if (isCf) {
      log('Cloudflare not resolved, reloading...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
      await ms(3000);
    } else break;
  }

  // ── Main loop ──
  let vplinkArrivals = 0;

  for (let cycle = 0; cycle < 40 && !destinationUrl; cycle++) {
    const url = safeURL();
    if (!url) { await ms(2000); continue; }
    log(`[cycle ${cycle + 1}] ${url.substring(0, 110)}`);
    await debugShot(`cycle-${cycle + 1}`);

    // Check if we're already at destination
    if (isDestination(url)) { destinationUrl = url; log('on destination URL already!'); break; }

    // ── vplink.in page ──
    if (url.includes('vplink.in') && !url.includes('cdn-cgi')) {
      vplinkArrivals++;
      const btnState = await safeEval(() => {
        const el = document.getElementById('get-link');
        if (!el) return 'missing';
        if (el.classList.contains('disabled')) return 'disabled';
        if (el.offsetParent === null) return 'hidden';
        return 'ready';
      });
      log(`get-link state: ${btnState}`);

      if (btnState === 'ready') {
        if (await doGetLink()) break;
        log('get-link failed, reloading vplink.in');
        for (const p of context.pages()) { if (p !== page) { try { await p.close(); } catch {} } }
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        await ms(3000);
        // Wait for potential auto-redirect
        for (let i = 0; i < 15; i++) {
          await ms(1000);
          if (!safeURL().includes('vplink.in')) break;
        }
        continue;
      }

      if (btnState === 'missing') {
        if (vplinkArrivals >= 3) {
          log('get-link missing for 3+ cycles, reloading');
          await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
          await ms(3000);
        } else {
          await ms(2000);
        }
        continue;
      }

      // disabled/hidden (countdown still running)
      await ms(2000);
      continue;
    }

    // ── Chrome error recovery ──
    if (url.startsWith('chrome-error://')) {
      log('chrome-error, force to vplink.in');
      await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
      await ms(3000);
      continue;
    }

    // ── Article / unknown page ──
    // Domains change weekly — treat any non-vplink non-destination as article
    log(`article/unknown: ${url.substring(0,80)}`);
    const navigated = await handleArticle();
    if (!navigated) {
      log('exhausted, force-navigating to vplink.in');
      await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
      await ms(2000);
      for (let i = 0; i < 15; i++) {
        await ms(1000);
        if (!safeURL().includes('vplink.in')) break;
      }
    }
  }

  // ── Final fallback ──
  if (!destinationUrl) {
    log('running final fallback...');

    // Try getting destination from current page
    let gotDest = false;

    // 1. Try doGetLink if on vplink.in
    if (safeURL().includes('vplink.in')) {
      gotDest = await doGetLink();
    }

    // 2. Find vplink link on page and go there
    if (!gotDest) {
      const vplinkHref = await safeEval(() => {
        const links = document.querySelectorAll('a[href*="vplink.in"]');
        for (const a of links) {
          if (a.href && !a.href.includes('cdn-cgi')) return a.href;
        }
        return null;
      });
      if (vplinkHref) {
        log('found vplink link on page');
        await page.goto(vplinkHref, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        await ms(3000);
        if (safeURL().includes('vplink.in')) gotDest = await doGetLink();
      }
    }

    // 3. Rapid direct attempts (catch GET link before redirect fires)
    if (!gotDest) {
      for (let a = 0; a < 3; a++) {
        log(`direct attempt ${a + 1}`);
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        for (let w = 0; w < 15; w++) {
          await ms(500);
          const cur = safeURL();
          if (cur.includes('vplink.in')) {
            const hasGl = await safeEval(() => !!document.getElementById('get-link'));
            if (hasGl && await doGetLink()) { gotDest = true; break; }
          } else break;
        }
        if (gotDest) break;
      }
    }

    if (gotDest) destinationUrl = safeURL();
  }

  // ── Output ──
  console.log('\n═════════════════════════════════════════');
  console.log('  ' + (destinationUrl ? '✅ DESTINATION URL:' : '⚠️  NO DESTINATION'));
  if (destinationUrl) console.log('  ' + destinationUrl);
  if (destinationUrl) fs.writeFileSync(path.join(__dirname, 'destination_url.txt'), destinationUrl);
  await ms(2000);
  await browser.close().catch(() => {});
})();
