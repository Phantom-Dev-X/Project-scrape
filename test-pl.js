const puppeteer = require('puppeteer');
const fs = require('fs');

async function test() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Try the polish number URL directly
    const testUrl = 'https://receive-sms.cc/Poland-Phone-Number/48797550008';
    console.log(`Testing: ${testUrl}`);
    await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const title = await page.title();
    const hasItem = await page.evaluate(() => document.querySelectorAll('div.item').length);
    console.log(`Title: ${title}`);
    console.log(`Items found: ${hasItem}`);
    
    if (hasItem > 0) {
      const messages = await page.evaluate(() => {
        const result = [];
        document.querySelectorAll('div.item').forEach(el => {
          result.push({
            from: el.querySelector('.form')?.innerText.trim(),
            time: el.querySelector('.time')?.innerText.trim(),
            content: el.querySelector('.con')?.innerText.trim()
          });
        });
        return result.slice(0, 3);
      });
      console.log('Sample messages:');
      messages.forEach(m => console.log(`  [${m.from}] [${m.time}] ${m.content?.substring(0, 80)}`));
    }
    
  } finally {
    await browser.close();
  }
}

test();
