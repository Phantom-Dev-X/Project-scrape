// test-sms.js
// Local test that mimics what the bot does on Render
// Run this to see the actual error

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

async function testScrape(phone) {
  console.log(`\n🧪 Testing with phone: ${phone}`);
  console.log(`URL: https://sms24.me/en/numbers/${phone}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    const url = `https://sms24.me/en/numbers/${phone}`;
    console.log(`1️⃣  Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`   ✅ Page loaded`);

    await new Promise(r => setTimeout(r, 3000));

    // Check what we see on the page
    const initialState = await page.evaluate(() => {
      const list = document.querySelector('[data-messages-list]');
      const button = document.querySelector('.sms-load-button');
      const hasInboxReady = !!document.querySelector('h3');
      return {
        hasMessagesList: !!list,
        messagesInList: list ? list.children.length : 0,
        hasButton: !!button,
        buttonText: button ? button.textContent.trim() : null,
        pageTitle: document.title,
        hasInboxReady
      };
    });
    console.log(`\n2️⃣  Initial page state:`, initialState);

    // Set localStorage
    console.log(`\n3️⃣  Setting localStorage to bypass ad gate...`);
    await page.evaluate(() => {
      localStorage.setItem('sms24_rewarded_seen_at', String(Date.now()));
    });
    console.log(`   ✅ Set sms24_rewarded_seen_at = now`);

    // Reload
    console.log(`\n4️⃣  Reloading page to apply localStorage...`);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    const afterReload = await page.evaluate(() => {
      const list = document.querySelector('[data-messages-list]');
      const button = document.querySelector('.sms-load-button');
      return {
        hasMessagesList: !!list,
        messagesInList: list ? list.children.length : 0,
        hasButton: !!button,
        buttonText: button ? button.textContent.trim() : null
      };
    });
    console.log(`   After reload:`, afterReload);

    // Find and click the button - DON'T RELOAD (my fix)
    console.log(`\n5️⃣  Looking for 'Show SMS messages' button...`);
    const buttonClicked = await page.evaluate(() => {
      const btn = document.querySelector('.sms-load-button') ||
                  Array.from(document.querySelectorAll('button')).find(b =>
                    b.textContent.includes('Show SMS') ||
                    b.textContent.includes('Load')
                  );
      if (btn) {
        btn.click();
        return { clicked: true, text: btn.textContent.trim() };
      }
      return { clicked: false, text: null };
    });
    console.log(`   Button:`, buttonClicked);

    if (buttonClicked.clicked) {
      console.log(`\n6️⃣  Waiting for messages to appear (polling every 2s, up to 60s)...`);

      let messagesLoaded = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const count = await page.evaluate(() => {
          const list = document.querySelector('[data-messages-list]');
          return list ? list.children.length : 0;
        });
        if (count > 0) {
          console.log(`   ✅ Messages appeared after ${(i + 1) * 2}s (${count} items)`);
          messagesLoaded = true;
          break;
        }
        if ((i + 1) % 5 === 0) {
          console.log(`   ... still waiting (${(i + 1) * 2}s, ${count} messages)`);
        }
      }

      if (!messagesLoaded) {
        console.log(`   ❌ Messages never appeared`);

        // Check for errors in the page
        const errors = await page.evaluate(() => {
          const errEl = document.querySelector('[data-messages-error]');
          const list = document.querySelector('[data-messages-list]');
          return {
            errorMessage: errEl ? errEl.textContent : null,
            listHTML: list ? list.innerHTML.substring(0, 500) : 'no list',
            bodyHasError: document.body.innerText.includes('error') || document.body.innerText.includes('blocked')
          };
        });
        console.log(`\n7️⃣  Error state:`, errors);
      } else {
        // Extract messages
        const messages = await page.evaluate(() => {
          const list = document.querySelector('[data-messages-list]');
          if (!list) return [];
          return Array.from(list.children).map(item => ({
            text: item.innerText,
            html: item.innerHTML.substring(0, 200)
          }));
        });
        console.log(`\n7️⃣  Found ${messages.length} messages:`);
        messages.forEach((m, i) => {
          console.log(`\n   Message ${i + 1}:`);
          console.log(`   ${m.text.substring(0, 300)}`);
        });
      }
    }

  } catch (error) {
    console.log(`\n❌ ERROR: ${error.message}`);
    console.log(error.stack);
  } finally {
    await browser.close();
    console.log(`\n✅ Browser closed`);
  }
}

// Test with multiple numbers
async function main() {
  const testNumbers = [
    '12393481596',  // US number
    '3584573998799', // Finland number
    '3197058026393'  // Netherlands number
  ];

  for (const num of testNumbers) {
    await testScrape(num);
    await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(console.error);
