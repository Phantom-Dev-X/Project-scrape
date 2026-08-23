// scraper-sms24.js
// Scrapes pages from SELECTED countries on sms24.me
// Currently configured for: Poland, Netherlands, Finland (3 countries)
// Add more countries by adding to the COUNTRIES list below

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const BASE = 'https://sms24.me/en';
const OUTPUT_FILE = 'data-sms24.json';

// 🎯 ONLY SCRAPE THESE COUNTRIES (3 for now, can add more later)
const COUNTRIES = [
  { name: 'Poland', code: 'pl' },
  { name: 'Netherlands', code: 'nl' },
  { name: 'Finland', code: 'fi' }
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomHeaders() {
  const languages = ['en-US,en;q=0.9', 'en-GB,en;q=0.9', 'en-US,en;q=0.5'];
  return {
    'User-Agent': getRandomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': languages[Math.floor(Math.random() * languages.length)],
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
  };
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Scrape ONE page of a country with retry logic
async function scrapeCountryPage(countryName, code, page = 1, retries = 3) {
  const url = page === 1
    ? `${BASE}/countries/${code}`
    : `${BASE}/countries/${code}?page=${page}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.get(url, {
        headers: getRandomHeaders(),
        timeout: 45000,
        maxRedirects: 5
      });

      const $ = cheerio.load(data);
      const numbers = [];

      $('a[href*="/en/numbers/"]').each((i, element) => {
        const href = $(element).attr('href');
        const phoneMatch = href.match(/\/numbers\/(\d+)/);

        if (phoneMatch) {
          const phoneRaw = phoneMatch[1];
          const phone = '+' + phoneRaw;

          const text = $(element).text();
          const timeMatch = text.match(/(\d+\s*(minute|hour|day|week|month)s?\s+ago)/i);
          const lastSms = timeMatch ? timeMatch[0] : 'Recent';

          numbers.push({
            country: countryName,
            phone: phone,
            smsCount: 'Live inbox',
            lastSms: lastSms,
            link: href.startsWith('http') ? href : `https://sms24.me${href}`,
            source: 'sms24.me'
          });
        }
      });

      // Check for pagination
      const hasNextPage = $('a[href*="?page="]').length > 0 || $('a:contains("Next")').length > 0;
      const hasMore = numbers.length >= 10 && hasNextPage;

      return { numbers, hasMore, url };
    } catch (error) {
      if (attempt < retries && (error.response?.status === 403 || error.response?.status === 429)) {
        const waitTime = 2000 * attempt;
        log(`   ⚠️  ${countryName} page ${page} ${error.response?.status} (attempt ${attempt}/${retries}), retrying in ${waitTime/1000}s...`);
        await delay(waitTime);
      } else {
        log(`   ❌ ${countryName} page ${page} failed: ${error.message}`);
        return { numbers: [], hasMore: false, url };
      }
    }
  }
  return { numbers: [], hasMore: false, url };
}

// Scrape ALL pages of a country
async function scrapeCountry(countryName, code, maxPages = 5) {
  log(`\n🔎 Starting ${countryName} (${code})...`);
  const allNumbers = [];
  let page = 1;
  let keepGoing = true;

  while (keepGoing && page <= maxPages) {
    const result = await scrapeCountryPage(countryName, code, page);

    if (result.numbers.length === 0) {
      log(`   ⏹️  ${countryName} page ${page}: 0 numbers, stopping`);
      keepGoing = false;
      break;
    }

    allNumbers.push(...result.numbers);
    log(`   📄 ${countryName} page ${page}: +${result.numbers.length} numbers (running total: ${allNumbers.length})`);

    if (!result.hasMore) {
      log(`   ⏹️  ${countryName} page ${page}: no more pages`);
      keepGoing = false;
      break;
    }

    page++;
    if (page <= maxPages) {
      await delay(1500 + Math.floor(Math.random() * 2500));
    }
  }

  log(`   ✅ ${countryName} DONE: ${allNumbers.length} numbers from ${page} page(s)`);
  return allNumbers;
}

async function scrapeAll() {
  log('🚀 ============================================');
  log('🚀 Starting scrape of SELECTED countries');
  log(`🚀 Countries: ${COUNTRIES.map(c => c.name).join(', ')}`);
  log('🚀 ============================================');
  const startTime = Date.now();

  const allNumbers = [];
  const totalCountries = COUNTRIES.length;

  for (let i = 0; i < COUNTRIES.length; i++) {
    const { name: countryName, code } = COUNTRIES[i];
    log(`\n📍 [${i + 1}/${totalCountries}] Processing ${countryName}...`);

    const nums = await scrapeCountry(countryName, code);
    allNumbers.push(...nums);

    log(`📊 Progress: ${i + 1}/${totalCountries} countries done, ${allNumbers.length} total numbers so far`);

    if (i < COUNTRIES.length - 1) {
      await delay(2000 + Math.floor(Math.random() * 3000));
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allNumbers, null, 2));
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

  log('\n🎉 ============================================');
  log(`🎉 SCRAPE COMPLETE!`);
  log(`🎉 Total: ${allNumbers.length} numbers from ${totalCountries} countries`);
  log(`🎉 Duration: ${duration} minutes`);
  log(`🎉 Saved to ${OUTPUT_FILE}`);
  log('🎉 ============================================\n');

  return allNumbers;
}

if (require.main === module) {
  scrapeAll()
    .then(() => process.exit(0))
    .catch(err => {
      log(`❌ Fatal error: ${err.message}`);
      log(err.stack);
      process.exit(1);
    });
}

module.exports = { scrapeAll, scrapeCountry, scrapeCountryPage };
