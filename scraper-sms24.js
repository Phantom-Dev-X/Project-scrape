// scraper-sms24.js
// Scrapes ALL pages of ALL countries from sms24.me
// Logs progress per page and running totals

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const BASE = 'https://sms24.me/en';
const OUTPUT_FILE = 'data-sms24.json';

const COUNTRY_CODES = {
  'United States': 'us',
  'United Kingdom': 'gb',
  'Canada': 'ca',
  'Germany': 'de',
  'France': 'fr',
  'Belgium': 'be',
  'Finland': 'fi',
  'Netherlands': 'nl',
  'Sweden': 'se',
  'Italy': 'it',
  'Spain': 'es',
  'Australia': 'au',
  'India': 'in',
  'China': 'cn',
  'Brazil': 'br',
  'Mexico': 'mx',
  'Poland': 'pl',
  'Switzerland': 'ch',
  'Austria': 'at',
  'Denmark': 'dk',
  'Norway': 'no',
  'Ireland': 'ie',
  'Portugal': 'pt',
  'Greece': 'gr',
  'Czech Republic': 'cz',
  'Romania': 'ro',
  'Hungary': 'hu',
  'Israel': 'il',
  'South Africa': 'za',
  'Japan': 'jp',
  'South Korea': 'kr',
  'New Zealand': 'nz',
  'Singapore': 'sg',
  'Hong Kong': 'hk',
  'Taiwan': 'tw',
  'Thailand': 'th',
  'Indonesia': 'id',
  'Malaysia': 'my',
  'Philippines': 'ph',
  'Vietnam': 'vn',
  'Argentina': 'ar',
  'Chile': 'cl',
  'Colombia': 'co',
  'Turkey': 'tr',
  'United Arab Emirates': 'ae',
  'Saudi Arabia': 'sa',
  'Egypt': 'eg',
  'Nigeria': 'ng',
  'Kenya': 'ke',
  'Russia': 'ru',
  'Ukraine': 'ua'
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Scrape ONE page of a country
async function scrapeCountryPage(countryName, code, page = 1) {
  const url = page === 1
    ? `${BASE}/countries/${code}`
    : `${BASE}/countries/${code}?page=${page}`;

  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive'
      },
      timeout: 45000  // 45 sec timeout
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
        const timeMatch = text.match(/(\d+\s*(minute|hour|day|week|month)s?\s*ago)/i);
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

    // Check for next page link
    const hasNextPage = $('a[href*="?page="]').length > 0 || $('a:contains("Next")').length > 0;
    const hasMore = numbers.length >= 10 && hasNextPage;

    return { numbers, hasMore, url };
  } catch (error) {
    log(`   ❌ ${countryName} page ${page} failed: ${error.message}`);
    return { numbers: [], hasMore: false, url };
  }
}

// Scrape ALL pages of a country (loops until no more pages)
async function scrapeCountry(countryName, code, maxPages = 20) {
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

    // Log per-page progress
    log(`   📄 ${countryName} page ${page}: +${result.numbers.length} numbers (running total: ${allNumbers.length})`);

    if (!result.hasMore) {
      log(`   ⏹️  ${countryName} page ${page}: no more pages`);
      keepGoing = false;
      break;
    }

    page++;

    // Be nice to the server
    if (page <= maxPages) {
      await delay(800 + Math.floor(Math.random() * 1500));
    }
  }

  log(`   ✅ ${countryName} DONE: ${allNumbers.length} numbers from ${page} page(s)`);
  return allNumbers;
}

async function scrapeAll() {
  log('🚀 ============================================');
  log('🚀 Starting FULL scrape of sms24.me');
  log('🚀 ============================================');
  const startTime = Date.now();

  const allNumbers = [];
  const countries = Object.entries(COUNTRY_CODES);
  const totalCountries = countries.length;

  for (let i = 0; i < countries.length; i++) {
    const [countryName, code] = countries[i];
    log(`\n📍 [${i + 1}/${totalCountries}] Processing ${countryName}...`);

    const nums = await scrapeCountry(countryName, code);
    allNumbers.push(...nums);

    // Log progress every country
    log(`📊 Progress: ${i + 1}/${totalCountries} countries done, ${allNumbers.length} total numbers so far`);

    // Save progress every 5 countries
    if ((i + 1) % 5 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allNumbers, null, 2));
      log(`💾 Progress saved: ${allNumbers.length} numbers to ${OUTPUT_FILE}`);
    }

    // Delay between countries
    if (i < countries.length - 1) {
      await delay(1500 + Math.floor(Math.random() * 2500));
    }
  }

  // Final save
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
