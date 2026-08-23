const puppeteer = require('puppeteer');

async function test() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto('https://receivesms.org', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));
    
    const data = await page.evaluate(() => {
      // Look for phone numbers in the page
      const numbers = [];
      const links = document.querySelectorAll('a[href*="sms"], a[href*="number"], a[href*="phone"]');
      links.forEach(a => {
        const href = a.getAttribute('href');
        const text = a.innerText;
        const phoneMatch = text.match(/\+?\d[\d\s\-]{8,}/);
        if (phoneMatch) {
          numbers.push({
            href,
            text: text.replace(/\s+/g, ' ').trim().substring(0, 100),
            phone: phoneMatch[0]
          });
        }
      });
      return numbers.slice(0, 20);
    });
    
    console.log(`Found ${data.length} potential numbers:`);
    data.forEach(n => console.log(`  ${n.phone} → ${n.href}`));
    console.log('');
    console.log('Page title:', await page.title());
    
  } finally {
    await browser.close();
  }
}

test();
