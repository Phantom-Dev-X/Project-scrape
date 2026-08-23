// scraper-rsms.js
// Scrapes numbers from receive-sms.cc homepage
// Works with Puppeteer (no Cloudflare blocking)

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

const BASE = 'https://receive-sms.cc';
const OUTPUT_FILE = 'data.json';

// Preferred countries (in priority order)
// Bot will show these first, but accept others if these aren't available
const PREFERRED_COUNTRIES = ['Poland', 'Netherlands', 'Finland'];

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
  log('🚀 Scraping receive-sms.cc (3 scrapes to get more variety)...');

  // Load existing data
  let existing = [];
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      log(`📂 Loaded ${existing.length} existing numbers from cache`);
    }
  } catch (e) {}

  // Scrape multiple times (each scrape shows different numbers in homepage rotation)
  const allNewNumbers = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`\n🔄 Scrape attempt ${attempt}/3...`);
    const numbers = await scrapeHomepage();
    log(`   Got ${numbers.length} numbers from this scrape`);

    // Filter to preferred
    const preferred = numbers.filter(n => PREFERRED_COUNTRIES.includes(n.country));
    const others = numbers.filter(n => !PREFERRED_COUNTRIES.includes(n.country));
    const sorted = [...preferred, ...others];

    allNewNumbers.push(...sorted);

    // Wait between scrapes
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  if (allNewNumbers.length === 0) {
    log('⚠️  No numbers found');
    return existing;
  }

  // Combine with existing, prefer fresh ones
  const allCombined = [...allNewNumbers, ...existing];

  // Dedupe by phone
  const seen = new Set();
  const unique = allCombined.filter(n => {
    if (seen.has(n.phone)) return false;
    seen.add(n.phone);
    return true;
  });

  // Sort: preferred first
  const preferred = unique.filter(n => PREFERRED_COUNTRIES.includes(n.country));
  const others = unique.filter(n => !PREFERRED_COUNTRIES.includes(n.country));
  const finalNumbers = [...preferred, ...others];

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalNumbers, null, 2));
  log(`\n💾 Saved ${finalNumbers.length} unique numbers (${allNewNumbers.length} new, ${existing.length} from cache)`);

  // Also clear old sms24.me data if it exists
  const oldFile = 'data-sms24.json';
  if (fs.existsSync(oldFile)) {
    fs.unlinkSync(oldFile);
    log(`🗑️  Removed old ${oldFile}`);
  }

  // Print by country
  const byCountry = {};
  finalNumbers.forEach(n => {
    byCountry[n.country] = (byCountry[n.country] || 0) + 1;
  });
  log('📊 By country:');
  Object.entries(byCountry).forEach(([c, n]) => log(`   ${c}: ${n}`));

  return finalNumbers;
}

if (require.main === module) {
  scrapeAll().then(() => process.exit(0)).catch(err => {
    log(`❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { scrapeAll, scrapeHomepage };
