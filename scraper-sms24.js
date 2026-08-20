// scraper-sms24.js
// Scrapes all pages of all countries from sms24.me

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
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

async function scrapeCountryPage(countryName, code, page = 1) {
  const url = page === 1
    ? `${BASE}/countries/${code}`
    : `${BASE}/countries/${code}?page=${page}`;

  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 30000
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

    return { numbers, hasMore: numbers.length >= 10 };
  } catch (error) {
    log(`   ❌ ${countryName} page ${page} failed: ${error.message}`);
    return { numbers: [], hasMore: false };
  }
}

async function scrapeCountry(countryName, code, maxPages = 10) {
  log(`🔎 ${countryName}...`);
  const allNumbers = [];

  for (let page = 1; page <= maxPages; page++) {
    const result = await scrapeCountryPage(countryName, code, page);

    if (result.numbers.length === 0) {
      log(`   ⏹️  Page ${page}: no more numbers`);
      break;
    }

    allNumbers.push(...result.numbers);

    if (!result.hasMore) {
      log(`   ⏹️  Page ${page}: last page`);
      break;
    }

    log(`   📄 Page ${page}: ${result.numbers.length} numbers`);

    if (page < maxPages) {
      await delay(800 + Math.floor(Math.random() * 1500));
    }
  }

  log(`   ✅ Total: ${allNumbers.length} numbers from ${countryName}`);
  return allNumbers;
}

async function scrapeAll() {
  log('🚀 Starting full scrape...');
  const startTime = Date.now();

  const allNumbers = [];
  const countries = Object.entries(COUNTRY_CODES);

  for (let i = 0; i < countries.length; i++) {
    const [countryName, code] = countries[i];
    const nums = await scrapeCountry(countryName, code);
    allNumbers.push(...nums);

    if ((i + 1) % 5 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allNumbers, null, 2));
      log(`💾 Progress saved: ${allNumbers.length} numbers`);
    }

    if (i < countries.length - 1) {
      await delay(1500 + Math.floor(Math.random() * 2500));
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allNumbers, null, 2));
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  log(`\n🎉 DONE! ${allNumbers.length} numbers from ${countries.length} countries in ${duration} min`);
  log(`💾 Saved to ${OUTPUT_FILE}`);

  return allNumbers;
}

if (require.main === module) {
  scrapeAll()
    .then(() => process.exit(0))
    .catch(err => {
      log(`❌ Fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { scrapeAll };
