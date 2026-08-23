const puppeteer = require('puppeteer');

async function test(phone) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const url = `https://sms24.me/en/numbers/${phone}`;
    console.log(`\n🧪 Testing ${phone}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // Set localStorage
    await page.evaluate(() => {
      localStorage.setItem('sms24_rewarded_seen_at', String(Date.now()));
    });
    console.log('  Set localStorage');
    
    // Click button directly (NO reload)
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('.sms-load-button');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log('  Clicked button:', clicked);
    
    // Wait for messages (poll for 30s)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const count = await page.evaluate(() => {
        const list = document.querySelector('[data-messages-list]');
        return list ? list.children.length : 0;
      });
      if (count > 0) {
        console.log(`  ✅ Got ${count} messages after ${i+1}s!`);
        const messages = await page.evaluate(() => {
          const list = document.querySelector('[data-messages-list]');
          return Array.from(list.children).map(c => c.innerText.substring(0, 200));
        });
        messages.forEach((m, j) => console.log(`    ${j+1}. ${m}`));
        break;
      }
    }
    
    // Check for errors
    const err = await page.evaluate(() => {
      const e = document.querySelector('[data-messages-error]');
      return e ? e.textContent : null;
    });
    if (err) console.log(`  ❌ Page error: ${err}`);
    
  } finally {
    await browser.close();
  }
}

async function main() {
  await test('12393481596');
  await new Promise(r => setTimeout(r, 3000));
  await test('3584573998799');
}

main().catch(console.error);
