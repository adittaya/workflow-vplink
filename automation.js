let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const fs = require('fs');

let browser;

process.on('SIGINT', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(130);
});

(async () => {
  const KEY = process.argv[2] || process.env.VPLINK_KEY;
  if (!KEY) { console.error('Usage: node automation.js <vplink_key>'); process.exit(1); }

  const launchOpts = { slowMo: 50 };
  if (process.env.VPLINK_TERMUX === '1') {
    launchOpts.headless = true;
    launchOpts.executablePath = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
    launchOpts.args = ['--no-sandbox', '--disable-gpu'];
  } else {
    launchOpts.headless = false;
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
  const clickSel = async sel => {
    try {
      return await page.evaluate(s => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }, sel);
    } catch { return false; }
  };
  const clickText = async txt => {
    try {
      return await page.evaluate(t => {
        const walker = document.createTreeWalker(document.body, 4, null, false);
        let n; while (n = walker.nextNode()) {
          if (n.textContent.trim() === t) {
            n.parentElement?.scrollIntoView({ block: 'center' });
            n.parentElement?.click();
            return true;
          }
        }
        return false;
      }, txt);
    } catch { return false; }
  };

  const isIntermediate = url => {
    return url.includes('vplink.in') || url.includes('onlinewish') || url.includes('krishitalk')
      || url.includes('learn_more') || url.includes('studydegree') || url.includes('studyblog');
  };

  const waitForArticleButton = async (timeoutSec = 65, skip = new Set()) => {
    for (let i = 0; i < timeoutSec; i++) {
      try {
        if (i > 0 && i % 3 === 0) {
          await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
        }
        const found = await page.evaluate((skipArr) => {
        const waitEl = document.getElementById('tp-wait1');
        const genEl = document.getElementById('tp-generate');
        if (waitEl || genEl) {
          const done = (waitEl && waitEl.style.display === 'none')
            || (genEl && genEl.style.display !== 'none' && genEl.style.display !== '');
          if (!done) return null;
        }
        const checks = [
          '#tp-snp2',
          '#cross-snp2',
          '#btn6',
          '#btn7 > button',
          'anchor',
          '[class*="verify"]',
          '[id*="verify"]',
          '[class*="btn-verify"]',
          '[class*="red"]',
          '[style*="color: red"]',
          '[style*="background: red"]',
          '[style*="background-color: red"]',
        ];
        for (const sel of checks) {
          if (skipArr.includes(sel)) continue;
          let el;
          if (sel === 'anchor') {
            el = document.querySelector('#main > div:nth-child(4) > center > center > a');
          } else {
            el = document.querySelector(sel);
          }
          if (!el) continue;
          const visible = el.offsetParent !== null
            && getComputedStyle(el).display !== 'none'
            && getComputedStyle(el).visibility !== 'hidden';
          if (visible) return sel;
        }
        // Text-based fallback: look for visible elements with Verify/Continue text
        const textChecks = document.querySelectorAll('a, button, span, div');
        for (const el of textChecks) {
          const txt = el.textContent.trim();
          if (skipArr.includes(txt)) continue;
          const low = txt.toLowerCase();
          if (low !== 'verify' && low !== 'continue') continue;
          if (el.offsetParent === null) continue;
          if (getComputedStyle(el).display === 'none') continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          el.scrollIntoView({ block: 'center' });
          el.click();
          return txt;
        }
        return null;
      }, [...skip]).catch(() => null);
      if (found) return found;
      await ms(1000);
      } catch (e) {
        return null;
      }
    }
    return null;
  };

  // ── START ──────────────────────────────────────────
  console.log('=== Start funnel ===');
  const navTimeout = process.env.VPLINK_PROXY ? 90000 : 45000;
  try {
    await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  } catch {
    console.log('  navigation timeout, retrying once...');
    await ms(2000);
    await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await ms(2000);

  // Wait for auto-redirect (if it's going to happen)
  for (let i = 0; i < 15; i++) {
    if (!page.url().includes('vplink.in')) break;
    await ms(1000);
  }

  const stuckUrls = new Set();
  let vplinkStreak = 0;

  outer:
  for (let cycle = 0; cycle < 30 && !destinationUrl; cycle++) {
    const url = page.url();
    console.log(`\n[${cycle + 1}] ${url.substring(0, 110)}`);

    if (url.includes('wistful') || url.includes('vv53243') || url.includes('casino') || url.includes('one-')) {
      destinationUrl = url; break;
    }

    if (url.includes('vplink.in') && !url.includes('cdn-cgi')) {
      vplinkStreak++;
      if (vplinkStreak >= 3) {
        console.log('  no auto-redirect — going straight to Get Link...');
      }

      const doGetLink = async () => {
        console.log('  waiting for Get Link...');
        try {
          const btn = await page.waitForSelector('#get-link, [class*="get-link"], a[href*="get-link"]', { timeout: 35000 }).catch(() => null);
          if (!btn) {
            console.log('  #get-link not found on page');
            return false;
          }
          await page.waitForFunction(() => {
            const el = document.getElementById('get-link');
            return el && !el.classList.contains('disabled');
          }, { timeout: 30000 }).catch(() => {});
          await ms(1000);
          console.log('  clicking Get Link...');
          const navPromise = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
          const newTabPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
          await page.click('#get-link', { timeout: 5000 }).catch(() => clickSel('#get-link'));
          let navigated = false;
          if (await navPromise) {
            console.log('  page navigated after Get Link');
            navigated = true;
          }
          const newTab = await newTabPromise;
          if (newTab) {
            console.log('  new tab opened, waiting for destination URL...');
            try {
              await newTab.waitForLoadState('domcontentloaded', { timeout: 20000 });
              await ms(5000);
              const tabUrl = newTab.url();
              console.log(`  new tab URL: ${tabUrl.substring(0, 100)}`);
              if (tabUrl && !tabUrl.includes('about:blank') && !tabUrl.includes('chrome-error') && !tabUrl.includes('vplink')) {
                destinationUrl = tabUrl;
              } else {
                console.log('  new tab is intermediate, watching for real navigation...');
                try {
                  await newTab.waitForNavigation({ timeout: 10000 });
                  await ms(3000);
                  const realUrl = newTab.url();
                  if (realUrl && !realUrl.includes('about:blank') && !realUrl.includes('chrome-error') && !realUrl.includes('vplink')) {
                    destinationUrl = realUrl;
                  }
                } catch {}
              }
            } catch (e) {
              console.log(`  new tab error: ${e.message.substring(0, 50)}`);
            }
            await newTab.close().catch(() => {});
            navigated = true;
          }
          if (navigated && !destinationUrl) {
            await ms(5000);
            const finalUrl = page.url();
            if (finalUrl && !isIntermediate(finalUrl)) {
              destinationUrl = finalUrl;
            }
          }
        } catch (e) {
          console.log(`  Get Link interrupted: ${e.message.substring(0, 50)}`);
        }
        // Fallback: check current page
        if (!destinationUrl) {
          const cur = page.url();
          for (let i = 0; i < 25; i++) {
            try {
              const u = page.url();
              if (u !== cur && !isIntermediate(u)) {
                destinationUrl = u; break;
              }
            } catch { break; }
            if (!(await ms(1000))) break;
          }
          try {
            const u = page.url();
            if (!isIntermediate(u)) destinationUrl = u;
          } catch {}
        }
        return !!destinationUrl;
      };

      if (vplinkStreak >= 3) {
        if (await doGetLink()) break;
        console.log('  Get Link failed — reloading for retry...');
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await ms(2000);
        vplinkStreak = 0;
        continue;
      }

      const hasBtn = await page.evaluate(() => {
        const el = document.getElementById('get-link');
        return el && el.offsetParent !== null;
      }).catch(() => false);

      if (hasBtn) {
        if (!(await doGetLink())) {
          console.log('  Get Link failed');
        }
        break;
      }
      await ms(2000);
      continue;
    }

    if (url.includes('onlinewish') || url.includes('krishitalk')) {
      if (stuckUrls.has(url)) {
        console.log('  already tried everything on this page, skipping...');
        await ms(3000);
        continue;
      }
      const startUrl = page.url();
      const tried = new Set();

      while (page.url() === startUrl) {
        const overlay = await page.evaluate(() => {
          const el = document.getElementById('common_15click_overlay');
          return el?.offsetParent ? el : null;
        }).catch(() => null);
        if (overlay) {
          await clickSel('#common_15click_overlay > div > div:nth-child(2) > div > span');
          await ms(500);
        }

        const btn = await waitForArticleButton(65, tried);
        if (!btn) {
          await clickText('Continue');
          console.log('  clicked text Continue');
          await ms(5000);
          if (page.url() === startUrl) break;
          continue;
        }

        const label = btn;
        if (btn === '#btn6') {
          await clickSel('#btn6');
          console.log('  clicked Verify');
          await ms(3000);
          for (let i = 0; i < 15; i++) {
            const clicked = await page.evaluate(() => {
              const el = document.querySelector('#btn7 > button');
              if (el && el.offsetParent !== null) {
                el.scrollIntoView({ block: 'center' });
                el.click();
                return true;
              }
              window.scrollBy(0, 300);
              return false;
            }).catch(() => false);
            if (clicked) { console.log('  clicked Continue (btn7)'); break; }
            await ms(1000);
          }
          await ms(5000);
        } else if (btn === 'anchor') {
          await clickSel('#main > div:nth-child(4) > center > center > a');
          console.log('  clicked anchor');
          await ms(5000);
        } else if (btn === 'Verify' || btn === 'Continue') {
          console.log(`  clicked text ${btn}`);
          await ms(5000);
        } else {
          await clickSel(btn);
          console.log(`  clicked ${label}`);
          await ms(5000);
        }

        if (page.url() === startUrl) {
          tried.add(btn);
        }
      }
      if (page.url() === startUrl) {
        stuckUrls.add(startUrl);
        console.log('  stuck — force-navigating to vplink.in...');
        await page.goto(`https://vplink.in/${KEY}`, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
      }
      continue;
    }

    // Unknown page — wait, might be a random ad that returns on its own
    for (let i = 0; i < 8; i++) {
      await ms(1000);
      if (page.url() !== url) continue outer;
    }
  }

  if (!destinationUrl) {
    // Final attempt: wait for Get Link one more time
    if (page.url().includes('vplink.in')) {
      try {
        await page.waitForSelector('#get-link:not(.disabled)', { timeout: 30000 });
        await ms(1000);
        const navFinal = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
        const tabFinal = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
        await page.click('#get-link', { timeout: 5000 }).catch(() => clickSel('#get-link'));
        const finalTab = await tabFinal;
        if (finalTab) {
          await finalTab.waitForLoadState('domcontentloaded', { timeout: 20000 });
          await ms(5000);
          const tu = finalTab.url();
          if (tu && !isIntermediate(tu)) destinationUrl = tu;
          await finalTab.close().catch(() => {});
        }
        if (!destinationUrl) {
          if (await navFinal) await ms(5000);
          const pu = page.url();
          if (!isIntermediate(pu)) destinationUrl = pu;
        }
      } catch {}
    }
    if (!destinationUrl) {
      const u = page.url();
      if (u && !isIntermediate(u)) destinationUrl = u;
    }
  }
  console.log('\n═════════════════════════════════════════');
  console.log('  ✅ DESTINATION URL:');
  console.log('  ' + destinationUrl);
  fs.writeFileSync('destination_url.txt', destinationUrl);
  await ms(3000);
  await browser.close();
})();
