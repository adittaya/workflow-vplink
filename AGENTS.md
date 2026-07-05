# VPLink 3.0 — Agent Context

## Overview
Automated vplink.in URL funnel: navigate auto-redirects, countdown timers, "Continue" buttons on onlinewish/krishitalk articles, click "Get Link" on vplink.in, and capture the final destination URL.

## Files
| File | Purpose |
|------|---------|
| `automation.js` | **Main script** — Puppeteer/Playwright automation of the full funnel (210 lines) |
| `vplink3.0.sh` | **Launcher** — Xvfb/VNC setup, loop for multiple views, result saving (100 lines) |
| `install.sh` | **Cross-platform installer** — deps, Node.js, Playwright Chromium, command symlink (145 lines) |
| `record.js` | Manual flow recorder — captures screenshots + DOM snapshots (268 lines) |
| `record.sh` | Recorder launcher with Xvfb + VNC |
| `package.json` | Deps: `playwright` + `playwright-core` |
| `.gitignore` | Excludes node_modules, screenshots, debug files, recording artifacts |

## Automation Flow (`automation.js`)

1. **Start** → navigate to `https://vplink.in/{KEY}`
2. **Auto-redirect** → vplink.in JS-redirects to onlinewish or krishitalk article page
3. **Article page** (onlinewish/krishitalk):
   - Wait for countdown (`#tp-wait1` / `#tp-generate` elements to disappear)
   - Click the visible button in priority order: `#tp-snp2` → `#cross-snp2` → `#btn6` (triggers Verify) → wait 3s → `#btn7 > button` (Continue) → `#main > div:nth-child(4) > center > center > a` (anchor fallback)
   - If no button found: clickText('Continue') fallback
   - Repeat cycle (can loop 4-6 times through different articles)
4. **vplink.in** (back after article cycle):
   - Wait for `#get-link` countdown (~7s, polling every 1s × 20)
   - Click `#get-link`
   - Capture destination from:
     a. **New tab** (if `window.open` fires) — reject `about:blank`/`chrome-error`/`vplink` URLs
     b. **Current page navigation** — poll up to 25s for URL change to non-intermediate URL
5. **Destination detected** → save to `destination_url.txt`

### Known destination URL patterns
- `wistfulseverely.com/api/users?token=...` (tracking/conversion endpoint)
- `12indiaplay.com/`
- `wistful` / `vv53243` / `casino` / `one-` prefixes

### Button priority on article pages
```
#tp-snp2  →  #cross-snp2  →  #btn6 (+ 3s wait → #btn7 > button)  →  anchor  →  text "Continue"
```

## Key Decisions
- **No hardcoded ad-domain handling** — ads are random and transient; the loop waits and re-checks URL
- **`#tp-snp2` priority over anchor** — anchor click caused `chrome-error://` page on health-insurance article
- **Close `about:blank` new tab** from `#get-link` click (`javascript: void(0)`) — then poll current page for real navigation
- **`generated_automation.js` deleted** — replaced by `automation.js`
- **Screenshots gitignored** via `screenshots/` rule (PNGs excluded from commits)

## Operating Modes
- **Desktop Linux**: headed Chromium via Xvfb (`:99`) + x11vnc (`:5900`)
- **Termux (Android)**: headless system Chromium, no display server
- Detection: `process.env.VPLINK_TERMUX === '1'`

## CLI Usage
```bash
# Interactive
vplink3.0

# Direct (from repo directory)
printf "KEY\nN\ny\n" | bash vplink3.0.sh
# where N = number of views, y = enable VNC

# Direct node
node automation.js <KEY>
```

## Result Files
- Each run saves to `destination_url_{view_number}.txt`
- Cleanup needed periodically (gitignored: `destination_url_*.txt`)

## Dependencies
- `playwright` (or `playwright-core` fallback for system Chromium)
- Chromium browser (bundled via `npx playwright install chromium`, or system on Termux)
- System: Xvfb, x11vnc, Playwright system libs (installed by `install.sh`)

## Cross-Platform Support
| Platform | Status |
|----------|--------|
| Ubuntu 22.04/24.04 | ✅ Tested |
| Debian | ✅ installer support |
| Fedora/RHEL | ✅ (yum/dnf) |
| Arch | ✅ (pacman) |
| openSUSE | ✅ (zypper) |
| Alpine | ✅ (apk) |
| Termux | ✅ (system Chromium, headless) |

## Known Issues / Future Work
- Xvfb `pkill -9 -f "Xvfb"` kills all system Xvfb instances (not just own PID)
- Article selectors are fragile — `#main > div:nth-child(4) > center > center > a` depends on krishitalk.com DOM structure
- No user-agent / viewport rotation for fingerprint diversity
- Interactive-only shell script — no `--key` / `--views` / `--vnc` flags for scripting
- Recording dirs (`recording_*/`) not gitignored — can bloat repo if committed
