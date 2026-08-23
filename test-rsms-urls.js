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
    
    // Try the homepage and look for country links
    await page.goto('https://receive-sms.cc', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const countries = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href*="-Phone-Number"]').forEach(a => {
        if (a.href.includes('/receive-sms') || a.href.includes('Phone-Number')) {
          links.push({
            href: a.href,
            text: a.innerText.trim().substring(0, 50)
          });
        }
      });
      // Also look for any links with country names
      return links.slice(0, 15);
    });
    
    console.log('Country links:');
    countries.forEach(c => console.log(`  ${c.text} → ${c.href}`));
    
  } finally {
    await browser.close();
  }
}

test();
