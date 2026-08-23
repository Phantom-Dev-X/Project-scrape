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
    
    await page.goto('https://receive-sms.cc/Finland-Phone-Number', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const html = await page.content();
    fs.writeFileSync('/home/user/project-scrpar/finland-page.html', html);
    console.log('Saved Finland page');
    
    // Look for all <a> tags
    const allLinks = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href.includes('Phone-Number/') || href.match(/\d{6,}/)) {
          result.push({
            href,
            text: a.innerText.substring(0, 100).replace(/\s+/g, ' ')
          });
        }
      });
      return result.slice(0, 10);
    });
    console.log('All relevant links:');
    allLinks.forEach(l => console.log(`  ${l.href} | ${l.text}`));
    
  } finally {
    await browser.close();
  }
}

test();
