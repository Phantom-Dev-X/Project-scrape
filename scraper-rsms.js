// scraper-rsms.js
// Scrapes numbers from receive-sms.cc country pages
// Hits /Countries/ to find all countries, then scrapes preferred countries with pagination

const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE = 'https://receive-sms.cc';
const OUTPUT_FILE = 'data.json';

// Preferred countries (in priority order) - gets all pages for these
const PREFERRED_COUNTRIES = ['Poland', 'Netherlands', 'Finland'];

// Max pages to scrape per country (each page has ~10 numbers)
const MAX_PAGES_PER_COUNTRY = 5;

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

async function launchBrowser() {
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
  }
  return await puppeteer.launch(launchOptions);
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });
  return page;
}

// Get the list of all countries from /Countries/ page
async function getCountryList(browser) {
  const page = await newPage(browser);
  try {
    log('📋 Fetching country list from /Countries/...');
    await page.goto(`${BASE}/Countries/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(3000);

    const countries = await page.evaluate(() => {
      const result = [];
      // Find all links to country pages
      document.querySelectorAll('a[href*="-Phone-Number"]').forEach(a => {
        const href = a.getAttribute('href') || '';
        // Skip if it's a specific number page (has digits at end)
        if (/\/(\d+)$/.test(href)) return;

        // Extract country info
        const text = a.innerText.replace(/\s+/g, ' ').trim();
        // URL pattern: /Poland-Phone-Number/ or /UK-Phone-Number/
        const urlMatch = href.match(/\/([A-Za-z]+)-Phone-Number\/?/);
        if (urlMatch) {
          const countrySlug = urlMatch[1];
          // Try to extract count from text
          const countMatch = text.match(/(\d+)/);
          result.push({
            slug: countrySlug,
            href: href.startsWith('http') ? href : `https://receive-sms.cc${href}`,
            text: text.substring(0, 50)
          });
        }
      });
      return result;
    });

    log(`✅ Found ${countries.length} countries`);
    return countries;
  } finally {
    await page.close();
  }
}

// Scrape numbers from a country page (with pagination)
async function scrapeCountryPage(page, baseUrl, countrySlug, pageNum) {
  const url = pageNum === 1
    ? baseUrl
    : `${baseUrl}Page/${pageNum}`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await delay(2000);

  const numbers = await page.evaluate((slug) => {
    const result = [];
    // First, find the phone from the URL (it's in the href)
    document.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      // Match /Country-Phone-Number/12345 (extract the number from URL)
      const urlMatch = href.match(new RegExp(`\\/${slug}-Phone-Number\\/(\\d+)`));
      if (urlMatch) {
        const phoneFromUrl = urlMatch[1];
        // Add the country code from the slug
        const countryName = slug
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, c => c.toUpperCase())
          .trim();
        // Format phone based on country
        let phone = '+' + phoneFromUrl;
        // For better readability, add a space after country code
        if (phoneFromUrl.length >= 10) {
          // Try to detect country code (rough)
          if (phoneFromUrl.startsWith('48')) phone = '+48 ' + phoneFromUrl.substring(2);
          else if (phoneFromUrl.startsWith('31')) phone = '+31 ' + phoneFromUrl.substring(2);
          else if (phoneFromUrl.startsWith('358')) phone = '+358 ' + phoneFromUrl.substring(3);
          else if (phoneFromUrl.startsWith('1')) phone = '+1 ' + phoneFromUrl.substring(1);
          else if (phoneFromUrl.startsWith('44')) phone = '+44 ' + phoneFromUrl.substring(2);
          else if (phoneFromUrl.startsWith('33')) phone = '+33 ' + phoneFromUrl.substring(2);
          else if (phoneFromUrl.startsWith('49')) phone = '+49 ' + phoneFromUrl.substring(2);
          else if (phoneFromUrl.startsWith('34')) phone = '+34 ' + phoneFromUrl.substring(2);
          else if (phoneFromUrl.startsWith('39')) phone = '+39 ' + phoneFromUrl.substring(2);
          else if (phoneFromUrl.startsWith('7')) phone = '+7 ' + phoneFromUrl.substring(1);
        }

        result.push({
          country: countryName,
          phone: phone,
          smsCount: 'Live',
          lastSms: 'Recent',
          link: href.startsWith('http') ? href : `https://receive-sms.cc${href}`,
          source: 'receive-sms.cc'
        });
      }
    });
    return result;
  }, countrySlug);

  return numbers;
}

// Scrape all pages of a country
async function scrapeCountry(browser, country, maxPages = MAX_PAGES_PER_COUNTRY) {
  const page = await newPage(browser);
  try {
    log(`🔎 Scraping ${country.slug}...`);
    const allNumbers = [];
    let pageNum = 1;
    let keepGoing = true;

    while (keepGoing && pageNum <= maxPages) {
      const numbers = await scrapeCountryPage(page, country.href, country.slug, pageNum);

      if (numbers.length === 0) {
        log(`   ⏹️  ${country.slug} page ${pageNum}: 0 numbers`);
        keepGoing = false;
        break;
      }

      allNumbers.push(...numbers);
      log(`   📄 ${country.slug} page ${pageNum}: +${numbers.length} (total: ${allNumbers.length})`);

      // Check if next page exists
      const hasNext = await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const a of links) {
          const text = a.innerText.trim();
          if (text === '›' || text === 'Next' || (text.match(/^\d+$/) && parseInt(text) > 1)) {
            return true;
          }
        }
        return false;
      });

      if (!hasNext) {
        log(`   ⏹️  No more pages`);
        keepGoing = false;
        break;
      }

      pageNum++;
      await delay(1500);
    }

    log(`   ✅ ${country.slug} done: ${allNumbers.length} numbers`);
    return allNumbers;
  } finally {
    await page.close();
  }
}

async function scrapeAll() {
  log('🚀 Starting receive-sms.cc scraper');
  const browser = await launchBrowser();

  try {
    // Load existing data
    let existing = [];
    try {
      if (fs.existsSync(OUTPUT_FILE)) {
        existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
        log(`📂 Loaded ${existing.length} existing numbers from cache`);
      }
    } catch (e) {}

    // Get country list
    const countries = await getCountryList(browser);

    // Find our preferred countries
    const preferred = [];
    for (const prefName of PREFERRED_COUNTRIES) {
      // Match by name (slug might be slightly different)
      const found = countries.find(c => {
        const normalizedSlug = c.slug.toLowerCase().replace(/[^a-z]/g, '');
        const normalizedPref = prefName.toLowerCase().replace(/[^a-z]/g, '');
        return normalizedSlug === normalizedPref ||
               normalizedSlug.includes(normalizedPref) ||
               normalizedPref.includes(normalizedSlug);
      });
      if (found) {
        preferred.push(found);
        log(`✅ Found preferred: ${prefName} → ${found.slug}`);
      } else {
        log(`⚠️  Not found: ${prefName}`);
      }
    }

    // Scrape each preferred country
    const newNumbers = [];
    for (const country of preferred) {
      const nums = await scrapeCountry(browser, country);
      newNumbers.push(...nums);
      await delay(2000);
    }

    if (newNumbers.length === 0) {
      log('⚠️  No new numbers found, keeping existing');
      return existing;
    }

    // Combine with existing
    const allCombined = [...newNumbers, ...existing];

    // Dedupe
    const seen = new Set();
    const unique = allCombined.filter(n => {
      if (seen.has(n.phone)) return false;
      seen.add(n.phone);
      return true;
    });

    // Sort: preferred first
    const preferredFinal = unique.filter(n => PREFERRED_COUNTRIES.some(p =>
      n.country.toLowerCase().replace(/[^a-z]/g, '').includes(p.toLowerCase().replace(/[^a-z]/g, ''))
    ));
    const othersFinal = unique.filter(n => !PREFERRED_COUNTRIES.some(p =>
      n.country.toLowerCase().replace(/[^a-z]/g, '').includes(p.toLowerCase().replace(/[^a-z]/g, ''))
    ));
    const finalNumbers = [...preferredFinal, ...othersFinal];

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalNumbers, null, 2));
    log(`\n💾 Saved ${finalNumbers.length} unique numbers (${newNumbers.length} new, ${existing.length} from cache)`);

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
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeAll().then(() => process.exit(0)).catch(err => {
    log(`❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { scrapeAll, getCountryList, scrapeCountry };
