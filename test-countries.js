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
    
    await page.goto('https://receive-sms.cc/Countries/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // Get all country links
    const countries = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href.includes('-Phone-Number') && !href.match(/\d/)) {
          const text = a.innerText.replace(/\s+/g, ' ').trim();
          // Try to extract count
          const countMatch = text.match(/(\d+)/);
          const count = countMatch ? parseInt(countMatch[1]) : null;
          // Get country name (first part)
          const name = text.split(/\d|\s\s/)[0].trim();
          if (name && name.length > 2) {
            result.push({
              name,
              href: href.startsWith('http') ? href : `https://receive-sms.cc${href}`,
              count,
              raw: text.substring(0, 100)
            });
          }
        }
      });
      return result;
    });
    
    console.log(`Found ${countries.length} countries:`);
    countries.forEach(c => {
      console.log(`  ${c.name}: ${c.count || '?'} numbers - ${c.href}`);
    });
    
  } finally {
    await browser.close();
  }
}

test();
