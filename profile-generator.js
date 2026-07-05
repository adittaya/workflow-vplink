const MOBILE_UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/UQ1A.240205.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Samsung Galaxy S24 Ultra SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Xiaomi 14 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; OnePlus 11 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; vivo X100 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Oppo Reno8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Nothing Phone 2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone14,3; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.165 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone16,2; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.165 Mobile/15E148 Safari/604.1',
];

const DESKTOP_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

const MOBILE_VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 414, height: 896 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
  { width: 384, height: 854 },
  { width: 412, height: 914 },
  { width: 360, height: 760 },
];

const DESKTOP_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

const YOUTUBE_REFERRERS = [
  'https://www.youtube.com/',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://m.youtube.com/',
  'https://www.youtube.com/shorts/',
  'https://www.youtube.com/results?search_query=video',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateProfile(mobile = false, youtube = false) {
  let ua, viewport;

  if (mobile) {
    ua = pick(MOBILE_UAS);
    viewport = pick(MOBILE_VIEWPORTS);
  } else {
    ua = pick(DESKTOP_UAS);
    viewport = pick(DESKTOP_VIEWPORTS);
  }

  const profile = { userAgent: ua, viewport };

  if (youtube) {
    profile.extraHTTPHeaders = {
      'Referer': pick(YOUTUBE_REFERRERS),
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
    };
  }

  return profile;
}

function generateViewport(mobile = false) {
  return mobile ? pick(MOBILE_VIEWPORTS) : pick(DESKTOP_VIEWPORTS);
}

function generateUserAgent(mobile = false) {
  return mobile ? pick(MOBILE_UAS) : pick(DESKTOP_UAS);
}

// CLI: node profile-generator.js [mobile=true] [youtube=true]
// Outputs: USER_AGENT|WIDTHxHEIGHT|REFERER
if (require.main === module) {
  const mobile = process.argv.includes('mobile=true') || process.argv.includes('mobile=1');
  const youtube = process.argv.includes('youtube=true') || process.argv.includes('youtube=1');
  const profile = generateProfile(mobile, youtube);
  const ua = profile.userAgent;
  const vp = profile.viewport;
  const ref = profile.extraHTTPHeaders?.Referer || '';
  process.stdout.write(`${ua}\n${vp.width}x${vp.height}\n${ref}`);
}

module.exports = { generateProfile, generateViewport, generateUserAgent, pick };
