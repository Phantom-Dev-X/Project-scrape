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
    
    await page.goto('https://receivesms.org', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));
    
    // Save the rendered HTML
    const html = await page.content();
    fs.writeFileSync('/home/user/project-scrpar/rsorg-rendered.html', html);
    
    // Look for any number-like content
    const allText = await page.evaluate(() => document.body.innerText);
    const phoneMatches = allText.match(/\+\d[\d\s\-]{8,20}/g) || [];
    console.log('Phone-like matches in text:');
    phoneMatches.slice(0, 10).forEach(p => console.log('  ' + p));
    console.log('');
    
    // Count all links
    const linkCount = await page.evaluate(() => document.querySelectorAll('a').length);
    console.log('Total links on page:', linkCount);
    
    // Look for any "number" or "sms" related links
    const interestingLinks = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        const text = (a.innerText || '').trim();
        if (href.includes('number') || href.includes('sms') || text.match(/\+?\d{6,}/)) {
          result.push({
            href: href.substring(0, 80),
            text: text.substring(0, 60)
          });
        }
      });
      return result.slice(0, 15);
    });
    console.log('\nInteresting links:');
    interestingLinks.forEach(l => console.log(`  [${l.text}] ${l.href}`));
    
  } finally {
    await browser.close();
  }
}

test();
