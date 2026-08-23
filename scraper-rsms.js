// scraper-rsms.js
// Scrapes numbers from receive-sms.cc homepage
// Works with Puppeteer (no Cloudflare blocking)

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

const BASE = 'https://receive-sms.cc';
const OUTPUT_FILE = 'data.json';

let CHROME_PATH = null;

function findChromePath() {
  const possible = [
    '/opt/render/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome',
    '/home/user/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome',
    '/root/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome'
  ];
  for (const p of possible) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

CHROME_PATH = findChromePath();

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function scrapeHomepage() {
  log('🚀 Scraping receive-sms.cc homepage...');

  const launchOptions = {
    headless: true,
    timeout: 90000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled'
    ]
  };

  if (CHROME_PATH) {
    launchOptions.executablePath = CHROME_PATH;
    log(`✅ Using Chrome: ${CHROME_PATH}`);
  } else {
    log('⚠️  No CHROME_PATH, using defaults');
  }

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    const numbers = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\/(US|UK|Finland|Poland|Netherlands|Germany|France)-Phone-Number\/(\d+)/);
        if (match) {
          const text = a.innerText;
          const phoneMatch = text.match(/\+?\d[\d\s]{8,}/);
          if (phoneMatch) {
            const countryName = match[1].replace(/-/g, ' ');
            const phone = phoneMatch[0].replace(/\s+/g, ' ').trim();

            // Try to extract SMS count
            const countMatch = text.match(/(\d+)\s*(?:SMS|messages|messages)/i);
            const count = countMatch ? countMatch[1] : 'Live';

            result.push({
              country: countryName,
              phone: phone,
              smsCount: count,
              lastSms: 'Recent',
              link: href.startsWith('http') ? href : `https://receive-sms.cc${href}`,
              source: 'receive-sms.cc'
            });
          }
        }
      });
      return result;
    });

    log(`✅ Found ${numbers.length} numbers`);
    return numbers;
  } finally {
    await browser.close();
  }
}

async function scrapeAll() {
  const numbers = await scrapeHomepage();

  if (numbers.length === 0) {
    log('⚠️  No numbers found');
    return [];
  }

  // Dedupe
  const seen = new Set();
  const unique = numbers.filter(n => {
    if (seen.has(n.phone)) return false;
    seen.add(n.phone);
    return true;
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(unique, null, 2));
  log(`💾 Saved ${unique.length} unique numbers to ${OUTPUT_FILE}`);

  // Also clear old sms24.me data if it exists
  const oldFile = 'data-sms24.json';
  if (fs.existsSync(oldFile)) {
    fs.unlinkSync(oldFile);
    log(`🗑️  Removed old ${oldFile}`);
  }

  // Print by country
  const byCountry = {};
  unique.forEach(n => {
    byCountry[n.country] = (byCountry[n.country] || 0) + 1;
  });
  log('📊 By country:');
  Object.entries(byCountry).forEach(([c, n]) => log(`   ${c}: ${n}`));

  return unique;
}

if (require.main === module) {
  scrapeAll().then(() => process.exit(0)).catch(err => {
    log(`❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { scrapeAll, scrapeHomepage };
