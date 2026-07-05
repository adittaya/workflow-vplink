const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const RECORDING_DIR = path.join(__dirname, `recording_${timestamp}`);
const SCREENSHOTS_DIR = path.join(RECORDING_DIR, 'screenshots');
const SNAPSHOTS_DIR = path.join(RECORDING_DIR, 'snapshots');

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

let events = [];
let screenshotCounter = 0;
let snapshotCounter = 0;

async function getSelector(el) {
  if (!el || el === document) return '';
  if (el.id) return '#' + CSS.escape(el.id);
  if (el === document.body) return 'body';
  if (el === document.documentElement) return 'html';
  const path = [];
  let current = el;
  while (current && current !== document.body && current !== document.documentElement) {
    let sel = current.tagName.toLowerCase();
    if (current.id) { path.unshift('#' + CSS.escape(current.id)); break; }
    if (current.className && typeof current.className === 'string') {
      const cls = current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) sel += '.' + cls;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        sel += `:nth-child(${Array.from(parent.children).indexOf(current) + 1})`;
      }
    }
    path.unshift(sel);
    current = current.parentElement;
  }
  return path.join(' > ');
}

async function main() {
  const VPLINK_KEY = process.argv[2] || process.env.VPLINK_KEY || 'UbpV2D';

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--auto-open-devtools-for-tabs',
      '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });

  // Expose recording function to browser
  await page.exposeFunction('__recordEvent', (data) => {
    data.time = Date.now();
    data.url = page.url();
    events.push(data);
    const label = data.type === 'click' ? `CLICK "${data.text || ''}" on ${data.selector || data.tagName}`
      : data.type === 'navigation' ? `NAV ${data.url.substring(0, 80)}`
      : data.type === 'input' ? `INPUT ${data.selector}="${(data.value || '').substring(0, 40)}"`
      : data.type;
    console.log(`  [${String(events.length).padStart(4)}] ${label}`);
  });

  // Inject event listeners
  await page.addInitScript(() => {
    window.__clickTargets = [];

    document.addEventListener('click', (e) => {
      const el = e.target;
      const path = [];
      let cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        let sel = cur.tagName.toLowerCase();
        if (cur.id) sel = '#' + CSS.escape(cur.id);
        const parent = cur.parentElement;
        if (parent) {
          const idx = Array.from(parent.children).indexOf(cur) + 1;
          const sameTag = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
          if (sameTag.length > 1) sel += `:nth-child(${idx})`;
        }
        path.unshift(sel);
        cur = cur.parentElement;
        if (cur && cur.id) { path.unshift('#' + CSS.escape(cur.id)); break; }
      }
      const selector = path.join(' > ');

      window.__recordEvent({
        type: 'click',
        tagName: el.tagName,
        id: el.id || null,
        className: typeof el.className === 'string' ? el.className.substring(0, 120) : null,
        text: (el.textContent || '').trim().substring(0, 120),
        href: el.href || null,
        selector: selector,
        x: e.clientX, y: e.clientY,
        pageX: e.pageX, pageY: e.pageY,
        innerText: el.innerText ? el.innerText.trim().substring(0, 80) : null,
        value: el.value || null,
        rect: el.getBoundingClientRect ? JSON.parse(JSON.stringify({ top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })) : null,
      });
    }, true);

    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') {
        window.__recordEvent({
          type: 'input',
          tagName: t.tagName,
          id: t.id || null,
          name: t.name || null,
          selector: t.id ? '#' + CSS.escape(t.id) : t.name ? `[name="${t.name}"]` : t.tagName.toLowerCase(),
          value: t.value.substring(0, 500),
          type: t.type || null,
        });
      }
    }, true);

    let lastScroll = 0;
    document.addEventListener('scroll', () => {
      const now = Date.now();
      if (now - lastScroll > 1000) {
        lastScroll = now;
        window.__recordEvent({
          type: 'scroll',
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          innerHeight: window.innerHeight,
          innerWidth: window.innerWidth,
        });
      }
    }, true);
  });

  // Navigation tracking
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      events.push({ type: 'navigation', url: frame.url(), time: Date.now() });
      console.log(`  [${String(events.length).padStart(4)}] NAV: ${frame.url().substring(0, 100)}`);
    }
  });

  // Dialog handling
  page.on('dialog', async dialog => {
    events.push({
      type: 'dialog',
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
      url: page.url(),
      time: Date.now(),
    });
    console.log(`  [${String(events.length).padStart(4)}] DIALOG: "${dialog.message().substring(0, 80)}"`);
    await dialog.accept().catch(() => {});
  });

  // Console capture
  page.on('console', msg => {
    events.push({ type: 'console', level: msg.type(), text: msg.text(), time: Date.now(), url: page.url() });
  });

  // Response capture
  page.on('response', resp => {
    if (resp.status() >= 301 && resp.status() <= 308) {
      events.push({
        type: 'redirect',
        status: resp.status(),
        from: resp.url(),
        to: resp.headers().location || '',
        time: Date.now(),
      });
    }
  });

  // Periodic screenshot + DOM snapshot
  const captureInterval = setInterval(async () => {
    try {
      screenshotCounter++;
      const sFile = `screenshot_${String(screenshotCounter).padStart(5, '0')}.png`;
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, sFile), fullPage: false }).catch(() => {});

      if (screenshotCounter % 3 === 0) {
        snapshotCounter++;
        const html = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
        const dFile = `dom_${String(snapshotCounter).padStart(4, '0')}.html`;
        fs.writeFileSync(path.join(SNAPSHOTS_DIR, dFile), html);
      }
    } catch (e) {}
  }, 3000);

  // Navigate to target
  const targetUrl = `https://vplink.in/${VPLINK_KEY}`;
  console.log(`\nNavigating to ${targetUrl} ...`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);

  console.log('\n' + '='.repeat(55));
  console.log('  RECORDING ACTIVE');
  console.log(`  Recording: ${RECORDING_DIR}`);
  console.log(`  Browser opened at ${targetUrl}`);
  console.log('  Complete the manual flow in the browser.');
  console.log('  Type "quit" + ENTER in this terminal to STOP & save.');
  console.log('='.repeat(55) + '\n');

  const rl = require('readline').createInterface({ input: process.stdin });
  await new Promise(resolve => rl.on('line', line => {
    if (line.trim().toLowerCase() === 'quit') { rl.close(); resolve(); }
  }));

  clearInterval(captureInterval);

  // Final screenshot
  try {
    screenshotCounter++;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `screenshot_${String(screenshotCounter).padStart(5, '0')}.png`), fullPage: true });
    snapshotCounter++;
    const html = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
    fs.writeFileSync(path.join(SNAPSHOTS_DIR, `dom_${String(snapshotCounter).padStart(4, '0')}.html`), html);
  } catch (e) {}

  // Save events
  fs.writeFileSync(path.join(RECORDING_DIR, 'events.json'), JSON.stringify(events, null, 2));

  // Save summary
  const summary = events.map((e, i) => {
    const t = e.type;
    const time = e.time ? new Date(e.time).toISOString().substring(11, 23) : '?';
    if (t === 'navigation') return `[${i}] ${time} NAV: ${e.url}`;
    if (t === 'click') return `[${i}] ${time} CLICK: ${e.selector || e.tagName} "${e.text || ''}" (${e.x},${e.y})`;
    if (t === 'input') return `[${i}] ${time} INPUT: ${e.selector} = "${e.value}"`;
    if (t === 'scroll') return `[${i}] ${time} SCROLL: (${e.scrollX},${e.scrollY})`;
    if (t === 'dialog') return `[${i}] ${time} DIALOG: "${e.message}"`;
    if (t === 'redirect') return `[${i}] ${time} ${e.status}: ${e.from.substring(0, 60)} → ${(e.to || '').substring(0, 60)}`;
    if (t === 'console') return `[${i}] ${time} CONSOLE[${e.level}]: ${(e.text || '').substring(0, 80)}`;
    return `[${i}] ${time} ${t}`;
  }).join('\n');
  fs.writeFileSync(path.join(RECORDING_DIR, 'summary.txt'), summary);

  // Save timing breakdown
  const navEvents = events.filter(e => e.type === 'navigation');
  const timing = navEvents.map((e, i) => {
    const prev = navEvents[i - 1];
    const diff = prev ? `+${((e.time - prev.time) / 1000).toFixed(1)}s` : '0s';
    return `  ${diff}: ${e.url}`;
  }).join('\n');
  fs.writeFileSync(path.join(RECORDING_DIR, 'timing.txt'), `Navigation timing:\n${timing}`);

  console.log(`\nRecording saved to ${RECORDING_DIR}`);
  console.log(`  events.json  - ${events.length} events`);
  console.log(`  screenshots/ - ${screenshotCounter} screenshots`);
  console.log(`  snapshots/   - ${snapshotCounter} DOM snapshots`);
  console.log(`  summary.txt  - event log`);
  console.log(`  timing.txt   - navigation timing`);

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
