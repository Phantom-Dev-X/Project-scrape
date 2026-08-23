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
    
    // Test country page
    await page.goto('https://receive-sms.cc/Finland-Phone-Number', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const numbers = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('a[href*="-Phone-Number/"]').forEach(a => {
        const href = a.getAttribute('href');
        // Match /Country-Phone-Number/12345
        if (/\/(US|UK|Finland|Poland|Netherlands|Germany|France)-Phone-Number\/\d+/.test(href)) {
          const text = a.innerText;
          const phoneMatch = text.match(/\+?\d[\d\s\-]{8,}/);
          if (phoneMatch) {
            result.push({
              phone: phoneMatch[0].replace(/\s+/g, ' ').trim(),
              href: href.startsWith('http') ? href : `https://receive-sms.cc${href}`
            });
          }
        }
      });
      return result;
    });
    
    console.log(`✅ Found ${numbers.length} numbers on Finland page:`);
    numbers.forEach(n => console.log(`  ${n.phone} → ${n.href}`));
    
  } finally {
    await browser.close();
  }
}

test();
