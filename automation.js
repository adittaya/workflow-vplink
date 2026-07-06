let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const fs = require('fs');
const path = require('path');

let browser;
process.on('SIGINT', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(130);
});

(async () => {
  const KEY = process.argv[2] || process.env.VPLINK_KEY;
  if (!KEY) { console.error('Usage: node automation.js <vplink_key>'); process.exit(1); }

  const launchOpts = {};
  if (process.env.VPLINK_TERMUX === '1') {
    launchOpts.headless = true;
    launchOpts.executablePath = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
    launchOpts.args = ['--no-sandbox', '--disable-gpu'];
  }
  if (process.env.VPLINK_PROXY) {
    launchOpts.args = [...(launchOpts.args || []), `--proxy-server=${process.env.VPLINK_PROXY}`];
  }
  if (process.env.VPLINK_EXTRA_ARGS) {
    launchOpts.args = [...(launchOpts.args || []), ...process.env.VPLINK_EXTRA_ARGS.split(' ')];
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
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60000);

  let destinationUrl = null;
  const ms = async t => { try { await page.waitForTimeout(t); } catch {} };
  const safeURL = () => { try { return page.url(); } catch { return ''; } };
  const safeEval = fn => { try { return page.evaluate(fn).catch(() => null); } catch { return null; } };

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

  const isArticlePage = async () => {
    return await safeEval(() => {
      return !!(document.getElementById('tp-wait1')
        || document.getElementById('ce-wait1')
        || document.getElementById('tp-snp2')
        || (document.getElementById('btn6') && document.getElementById('btn6').offsetParent !== null)
        || document.querySelector('#main > div:nth-child(4) > center > center > a'));
    });
  };

  const isVplinkPage = async () => {
    return await safeEval(() => {
      return !!(document.getElementById('get-link') || document.getElementById('gt-link'));
    });
  };

  // ── Inject cookies & force-show buttons (called each loop iteration) ──
  const showArticleButtons = async () => {
    await safeEval(() => {
      document.cookie = "eonudb=insurance,online_colleges,study_abroad,finance,loan; max-age=3600; path=/;";
      document.cookie = "adcadg=insurance,online_colleges,study_abroad,finance,loan; max-age=3600; path=/;";
      const hide = ['ce-wait1', 'tp-wait1', 'tp-time'];
      hide.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      const show = ['btn6', 'tp-snp2', 'cross-snp2', 'getlink', 'tp-generate', 'ce-text'];
      show.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; });
      const gc = document.getElementById('gcont');
      if (gc) gc.style.position = 'static';
      const snp = document.getElementById('tp-snp2');
      if (snp) { const a = snp.closest('a'); if (a) a.style.display = 'block'; }
      const ct = document.querySelector('#btn7 > button');
      if (ct) { const p = ct.closest('#btn7'); if (p) p.style.display = 'block'; ct.style.display = 'block'; }
    });
    await ms(300);
  };

  // ── Article button finder ──
  const findArticleButton = async (tried = new Set()) => {
    for (let i = 0; i < 30; i++) {
      try {
        if (i > 0 && i % 3 === 0)
          await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});

        const btn = await page.evaluate(triedArr => {
          const v = el =>
            el && el.offsetParent !== null
            && getComputedStyle(el).display !== 'none'
            && getComputedStyle(el).visibility !== 'hidden';

          // Check if countdowns are still running
          for (const id of ['tp-wait1', 'ce-wait1']) {
            const el = document.getElementById(id);
            if (el && v(el)) return null;
          }

          // Check 15-click overlay
          const ov = document.getElementById('common_15click_overlay');
          if (ov && v(ov)) return 'overlay';

          const checks = [
            '#tp-snp2',
            '#cross-snp2',
            '#btn6',
            '#btn7 > button',
            '#btn7',
            '#main > div:nth-child(4) > center > center > a',
          ];
          for (const sel of checks) {
            if (triedArr.includes(sel)) continue;
            const el = document.querySelector(sel);
            if (v(el)) return sel;
          }

          // Text-based
          const te = document.querySelectorAll('a, button, span, div, input');
          for (const el of te) {
            const txt = el.textContent.trim().toLowerCase();
            if (txt !== 'verify' && txt !== 'continue') continue;
            if (triedArr.includes(txt)) continue;
            if (!v(el)) continue;
            el.scrollIntoView({ block: 'center' });
            return txt;
          }
          return null;
        }, [...tried]);

        if (btn) return btn;
      } catch {}
      await ms(1000);
    }
    return null;
  };

  // ── Get Link ──
  const doGetLink = async () => {
    try {
      const btn = await page.waitForSelector('#get-link', { timeout: 35000 }).catch(() => null);
      if (!btn) return false;

      await page.waitForFunction(() => {
        const el = document.getElementById('get-link');
        return el && !el.classList.contains('disabled');
      }, { timeout: 30000 }).catch(() => {});
      await ms(500);

      console.log('  clicking Get Link');
      const newTabPromise = context.waitForEvent('page', { timeout: 30000 }).catch(() => null);

      await clickEl('#get-link');

      let newTab = await newTabPromise;

      console.log('  waiting for destination...');
      let stableUrl = null;
      let stableCount = 0;

      for (let i = 0; i < 40; i++) {
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
            // Navigate main page to destination so conversion pixels can fire
            try {
              await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
              await ms(3000);
            } catch {}
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

  // ── Handle article button click ──
  const handleArticleBtn = async (btn, tried) => {
    if (btn === 'overlay') {
      await clickEl('#common_15click_overlay > div > div:nth-child(2) > div > span');
      console.log('  dismissed overlay');
      await ms(500);
      return;
    }
    if (btn === '#btn6') {
      await clickEl('#btn6');
      console.log('  clicked Verify');
      // Wait for nextbtn() to process and show #btn7
      await ms(5000);
      for (let i = 0; i < 15; i++) {
        const c = await clickEl('#btn7 > button') || await clickEl('#btn7');
        if (c) { console.log('  clicked Continue'); await ms(5000); break; }
        await page.evaluate(() => window.scrollBy(0, 300)).catch(() => {});
        await ms(1000);
      }
    } else if (btn === '#btn7' || btn === '#btn7 > button') {
      await clickEl(btn);
      console.log('  clicked Continue');
      await ms(5000);
    } else if (btn === 'verify' || btn === 'continue') {
      await clickText(btn);
      console.log(`  clicked text ${btn}`);
      await ms(5000);
    } else {
      await clickEl(btn);
      console.log(`  clicked ${btn}`);
      await ms(5000);
    }
  };

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
  await page.waitForLoadState('networkidle').catch(() => {});
  await ms(2000);

  // Wait for possible auto-redirect
  for (let i = 0; i < 15; i++) {
    const u = safeURL();
    if (!u.includes('vplink.in')) break;
    await ms(1000);
  }

  const stuckUrls = new Set();
  const triedButtons = new Set();
  let vplinkMisses = 0;

  // ── Main loop ──
  for (let cycle = 0; cycle < 30 && !destinationUrl; cycle++) {
    const url = safeURL();
    if (!url) { await ms(2000); continue; }
    console.log(`\n[${cycle + 1}] ${url.substring(0, 110)}`);

    if (isDestination(url)) { destinationUrl = url; break; }

    // ── Check if this is an article-like page ──
    const isArticle = await isArticlePage();
    const isVplink = await isVplinkPage();

    // ── vplink.in ──
    if (isVplink || (url.includes('vplink.in') && !url.includes('cdn-cgi'))) {
      vplinkMisses++;
      const hasBtn = await safeEval(() => {
        const el = document.getElementById('get-link');
        return el && el.offsetParent !== null;
      });
      if (hasBtn || vplinkMisses >= 3) {
        if (hasBtn) {
          if (await doGetLink()) break;
          console.log('  Get Link failed — reloading');
        }
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await ms(3000);
        if (await doGetLink()) break;
        await ms(2000);
        continue;
      }
      await ms(2000);
      continue;
    }

    // ── Article page ──
    if (isArticle || url.includes('onlinewish') || url.includes('krishitalk') || url.includes('learn_more')) {
      if (stuckUrls.has(url)) {
        console.log('  stuck — trying Get Link directly');
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        // Check for Get Link a few times (vplink.in may auto-redirect, but the
        // key is consumed so Get Link may not appear — one last attempt)
        for (let i = 0; i < 5; i++) {
          await ms(1000);
          if (await doGetLink()) break;
          if (destinationUrl) break;
          // If page left vplink.in, go back
          const cur = safeURL();
          if (!cur.includes('vplink.in') && !isDestination(cur)) {
            await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
          }
        }
        if (!destinationUrl) break; // key exhausted — give up
        continue;
      }

      const startUrl = safeURL();
      triedButtons.clear();

      // Initial: focus iframe to trigger verification monitor
      await safeEval(() => {
        const iframe = document.querySelector('iframe[src*="google_ads"], iframe[id*="google_ads"], iframe');
        if (iframe) iframe.focus();
      });

      while (safeURL() === startUrl) {
        // Re-inject every loop iteration — page JS may revert display changes
        await showArticleButtons();

        const btn = await findArticleButton(triedButtons);
        if (!btn) {
          await clickText('Continue');
          await ms(5000);
          if (safeURL() === startUrl) break;
          continue;
        }

        await handleArticleBtn(btn, triedButtons);

        if (safeURL() === startUrl) {
          triedButtons.add(btn);
          console.log(`  ${btn} didn't navigate, trying next`);
        }
      }

      if (safeURL() === startUrl) {
        stuckUrls.add(startUrl);
        console.log('  exhausted — force to vplink.in');
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
      }
      continue;
    }

    // ── Unknown (ad) — wait for navigation ──
    for (let i = 0; i < 8; i++) {
      await ms(1000);
      const u = safeURL();
      if (u !== url) break;
    }
  }

  if (!destinationUrl) {
    if (safeURL().includes('vplink.in')) await doGetLink();
  }

  console.log('\n═════════════════════════════════════════');
  console.log('  ✅ DESTINATION URL:');
  console.log('  ' + (destinationUrl || 'N/A'));
  if (destinationUrl) fs.writeFileSync(path.join(__dirname, 'destination_url.txt'), destinationUrl);
  await ms(2000);
  await browser.close();
})();
