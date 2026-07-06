# Fix: Don't interrupt wistfulseverely conversion tracking

## Problem
After capturing the destination URL in `doGetLink()`, the current code force-navigates the main page to the destination URL (`page.goto(currentUrl)`). This interrupts the main page's natural navigation to `wistfulseverely.com/api/users?token=...` — which is the actual conversion tracking endpoint that increments the dashboard counter.

## Fix
In `automation.js`, replace the `page.goto()` navigation with a simple 5s wait.

## File: `automation.js`
**Lines 250-256** (current):
```js
destinationUrl = currentUrl;
// Navigate main page to destination so conversion pixels can fire
try {
  await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await ms(3000);
} catch {}
return true;
```

**Replace with**:
```js
destinationUrl = currentUrl;
// Let main page complete its wistfulseverely tracking naturally
await ms(5000);
return true;
```

## Why this works
- The natural flow after clicking Get Link: main page → wistfulseverely API (this is the conversion tracker), new tab → destination URL
- Force-navigating the main page to the destination interrupts the wistfulseverely request mid-flight
- The dashboard only counts conversions when the wistfulseverely API call completes
- By NOT navigating, we let the wistfulseverely tracking finish naturally
- The destination URL is already captured from the new tab — no need to load it again on the main page

## Verification
1. `node -c automation.js` — syntax check
2. Run `node automation.js <key>` — verify destination still captured
3. Check dashboard after several views — count should increase from ~30% to higher
