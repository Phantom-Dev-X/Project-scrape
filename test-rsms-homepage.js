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
    
    // Try the homepage
    await page.goto('https://receive-sms.cc', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    
    const html = await page.content();
    fs.writeFileSync('/home/user/project-scrpar/home.html', html);
    
    const numbers = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        // Match individual number pages
        const match = href.match(/\/(US|UK|Finland|Poland|Netherlands|Germany|France)-Phone-Number\/(\d+)/);
        if (match) {
          const text = a.innerText;
          const phoneMatch = text.match(/\+?\d[\d\s]{8,}/);
          if (phoneMatch) {
            result.push({
              country: match[1],
              phone: phoneMatch[0].replace(/\s+/g, ' ').trim(),
              href: href.startsWith('http') ? href : `https://receive-sms.cc${href}`,
              text: text.substring(0, 100).replace(/\s+/g, ' ')
            });
          }
        }
      });
      return result.slice(0, 30);
    });
    
    console.log(`✅ Found ${numbers.length} numbers on homepage:`);
    numbers.forEach(n => console.log(`  ${n.country}: ${n.phone}`));
    
  } finally {
    await browser.close();
  }
}

test();
