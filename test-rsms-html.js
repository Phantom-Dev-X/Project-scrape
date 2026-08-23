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
    
    await page.goto('https://receive-sms.cc/United-States-Phone-Number', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const html = await page.content();
    fs.writeFileSync('/home/user/project-scrpar/us-page.html', html);
    
    // Extract a sample of the HTML to see structure
    const sample = await page.evaluate(() => {
      const containers = document.querySelectorAll('a[href*="Phone-Number"]');
      const samples = [];
      for (let i = 0; i < Math.min(5, containers.length); i++) {
        const a = containers[i];
        samples.push({
          href: a.getAttribute('href'),
          text: a.innerText.substring(0, 200),
          classes: a.className
        });
      }
      return {
        totalLinks: containers.length,
        samples
      };
    });
    console.log(JSON.stringify(sample, null, 2));
  } finally {
    await browser.close();
  }
}

test();
