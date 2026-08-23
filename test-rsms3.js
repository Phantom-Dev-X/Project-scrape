const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

async function test() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const url = 'https://receive-sms.cc/US-Phone-Number/16506671441';
    console.log(`Testing: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    
    const html = await page.content();
    const $ = cheerio.load(html);
    const messages = [];
    $('div.item').each((i, el) => {
      const from = $(el).find('.form').text().trim();
      const time = $(el).find('.time').text().trim();
      const content = $(el).find('.con').text().trim();
      if (content) messages.push({ from, time, content });
    });
    
    console.log(`✅ Got ${messages.length} messages from receive-sms.cc via puppeteer:`);
    messages.slice(0, 3).forEach((m, i) => {
      console.log(`  ${i+1}. [${m.from}] [${m.time}] ${m.content.substring(0, 100)}`);
    });
    
  } finally {
    await browser.close();
  }
}

test();
