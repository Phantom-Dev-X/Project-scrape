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
    
    // Test Poland page
    const url = 'https://receive-sms.cc/Poland-Phone-Number/';
    console.log(`Testing: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    
    const numbers = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        // Match /Poland-Phone-Number/12345
        if (/\/Poland-Phone-Number\/\d+/.test(href)) {
          const text = a.innerText;
          const phoneMatch = text.match(/\+?\d[\d\s]{8,}/);
          if (phoneMatch) {
            result.push({
              phone: phoneMatch[0].replace(/\s+/g, ' ').trim(),
              href: href.startsWith('http') ? href : `https://receive-sms.cc${href}`,
              text: text.substring(0, 100).replace(/\s+/g, ' ').trim()
            });
          }
        }
      });
      return result;
    });
    
    console.log(`Found ${numbers.length} Poland numbers:`);
    numbers.slice(0, 5).forEach(n => console.log(`  ${n.phone} → ${n.href}`));
    
    // Check for pagination
    const hasPagination = await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const a of links) {
        const text = a.innerText.trim();
        if (text.match(/^\d+$/) || text.includes('Next') || text.includes('›')) {
          return { found: true, text, href: a.href };
        }
      }
      return { found: false };
    });
    console.log(`\nPagination:`, hasPagination);
    
  } finally {
    await browser.close();
  }
}

test();
