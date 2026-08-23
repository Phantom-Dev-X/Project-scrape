// bot.js
// Telegram bot for free SMS numbers
// Reads from Supabase (persistent) with local file fallback
// Auto-runs scraper if data is stale
// Token is loaded from environment variable (set in Render dashboard)
// FEATURE: Posts fresh codes (< 5 min) to channel

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const supabaseStore = require('./supabase-store');
const { scrapeAll } = require('./scraper-sms24');

// Find Chrome executable path (handles both local and Render)
function findChromePath() {
  // 1. Check environment variable (can be set in Render)
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  // 2. Check common Puppeteer cache locations
  const possiblePaths = [
    '/opt/render/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome',
    path.join(process.env.HOME || '/root', '.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome'),
    path.join(process.env.HOME || '/root', '.cache/puppeteer/chrome'),
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch (e) {}
  }

  // 3. Try to find any chrome-linux64/chrome in the cache
  try {
    const cacheDir = path.join(process.env.HOME || '/root', '.cache/puppeteer/chrome');
    if (fs.existsSync(cacheDir)) {
      const versions = fs.readdirSync(cacheDir);
      for (const ver of versions) {
        const chromePath = path.join(cacheDir, ver, 'chrome-linux64', 'chrome');
        if (fs.existsSync(chromePath)) {
          return chromePath;
        }
      }
    }
  } catch (e) {}

  return null;
}

const CHROME_PATH = findChromePath();
if (CHROME_PATH) {
  console.log(`✅ Found Chrome at: ${CHROME_PATH}`);
} else {
  console.log(`⚠️  Chrome not found - will use Puppeteer defaults`);
}

// Token comes from environment variable - NEVER hardcode it
const token = process.env.BOT_TOKEN;
const CHANNEL = process.env.CHANNEL_USERNAME || '@tmpsms';

if (!token) {
  console.error('❌ BOT_TOKEN environment variable is not set!');
  console.error('Set it in your .env file (local) or Render dashboard (production)');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// How recent must a code be to be posted to channel (in minutes)
const FRESH_WINDOW_MINUTES = 5;

// Load data from Supabase (with local fallback)
let data = [];
let isLoading = false;

async function loadData() {
  if (isLoading) return;
  isLoading = true;
  try {
    data = await supabaseStore.getAllNumbers();
    if (data.length === 0) {
      console.log('⚠️  No numbers found. Will scrape on first /start or use .scrape');
    } else {
      console.log(`📂 Loaded ${data.length} numbers from ${supabaseStore.isEnabled() ? 'Supabase' : 'local file'}`);
    }
  } catch (e) {
    console.log(`❌ Load error: ${e.message}`);
    data = [];
  } finally {
    isLoading = false;
  }
}

// Run scraper and reload
let isScraping = false;
async function runScraperAndReload(chatId = null) {
  if (isScraping) {
    if (chatId) bot.sendMessage(chatId, '⚠️ Scraper is already running, please wait...');
    return;
  }
  isScraping = true;
  const statusMsg = chatId ? await bot.sendMessage(chatId, '🔄 Running scraper... This may take 30-60 seconds.') : null;

  try {
    const newNumbers = await scrapeAll();
    if (newNumbers && newNumbers.length > 0) {
      const result = await supabaseStore.saveNumbers(newNumbers);
      await loadData();
      if (statusMsg) {
        await bot.editMessageText(
          `✅ *Scrape complete!*\n\n` +
          `📊 Saved: ${result.saved} numbers\n` +
          `💾 Storage: ${supabaseStore.isEnabled() ? 'Supabase ☁️' : 'Local file 💾'}\n` +
          `🌍 Countries: ${[...new Set(newNumbers.map(n => n.country))].join(', ')}`,
          { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
        );
      }
    } else {
      if (statusMsg) {
        await bot.editMessageText('⚠️ Scraper returned 0 numbers. Try again later.', {
          chat_id: chatId, message_id: statusMsg.message_id
        });
      }
    }
  } catch (e) {
    if (statusMsg) {
      await bot.editMessageText(`❌ Scrape failed: ${e.message}`, {
        chat_id: chatId, message_id: statusMsg.message_id
      });
    }
  } finally {
    isScraping = false;
  }
}

// Check if data is stale and auto-refresh
async function ensureFreshData() {
  if (data.length === 0) {
    console.log('⚠️  No data, running scraper...');
    const newNumbers = await scrapeAll();
    if (newNumbers && newNumbers.length > 0) {
      await supabaseStore.saveNumbers(newNumbers);
      await loadData();
    }
    return;
  }

  const stale = await supabaseStore.isStale();
  if (stale) {
    console.log('🔄 Data is stale, re-scraping...');
    const newNumbers = await scrapeAll();
    if (newNumbers && newNumbers.length > 0) {
      await supabaseStore.saveNumbers(newNumbers);
      await loadData();
    }
  }
}

loadData().then(() => ensureFreshData());

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getCountries() {
  return [...new Set(data.map(n => n.country))].sort();
}

function getCountryCount(country) {
  return data.filter(n => n.country === country).length;
}

function getRandomNumber(country) {
  const filtered = data.filter(n => n.country === country);
  if (filtered.length === 0) return null;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

function numberKeyboard(phone) {
  return {
    inline_keyboard: [
      [
        { text: '📩 Get SMS', callback_data: `sms_${phone}` },
        { text: '🔄 New number', callback_data: `new_${phone}` }
      ],
      [
        { text: '🌍 Change country', callback_data: 'change_country' }
      ]
    ]
  };
}

function countryKeyboard(page = 0) {
  const allCountries = getCountries();
  const perPage = 12;
  const totalPages = Math.ceil(allCountries.length / perPage);
  const start = page * perPage;
  const countries = allCountries.slice(start, start + perPage);

  const buttons = [];

  for (let i = 0; i < countries.length; i += 2) {
    const row = [];
    row.push({
      text: `${countries[i]} (${getCountryCount(countries[i])})`,
      callback_data: `pick_${countries[i]}`
    });
    if (countries[i + 1]) {
      row.push({
        text: `${countries[i + 1]} (${getCountryCount(countries[i + 1])})`,
        callback_data: `pick_${countries[i + 1]}`
      });
    }
    buttons.push(row);
  }

  const navRow = [];
  if (page > 0) {
    navRow.push({ text: '⬅️ Previous', callback_data: `page_${page - 1}` });
  }
  if (page < totalPages - 1) {
    navRow.push({ text: 'Next ➡️', callback_data: `page_${page + 1}` });
  }
  if (navRow.length > 0) {
    buttons.push(navRow);
  }

  return buttons;
}

// Parse "5 minutes ago" or "2 hours ago" or "30 seconds ago" into minutes
function parseTimeAgo(timeStr) {
  if (!timeStr) return Infinity;
  const lower = timeStr.toLowerCase().trim();
  const match = lower.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return Infinity;
  const num = parseInt(match[1]);
  const unit = match[2];
  if (unit === 'second') return num / 60;
  if (unit === 'minute') return num;
  if (unit === 'hour') return num * 60;
  if (unit === 'day') return num * 60 * 24;
  if (unit === 'week') return num * 60 * 24 * 7;
  if (unit === 'month') return num * 60 * 24 * 30;
  if (unit === 'year') return num * 60 * 24 * 365;
  return Infinity;
}

// Cache for messages
const messageCache = new Map();
const CACHE_TTL = 30 * 1000; // 30 sec cache (so we get fresh data)

async function fetchMessages(num) {
  if (!num || !num.link) return null;

  const cached = messageCache.get(num.phone);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.messages;
  }

  log(`📩 Fetching SMS for ${num.phone} (source: ${num.source})...`);

  // Method 1: Puppeteer with button click (most reliable, beats ad gate)
  if (num.source === 'sms24.me') {
    try {
      const messages = await fetchWithPuppeteerClick(num.link);
      if (messages && messages.length > 0) {
        log(`   ✅ Got ${messages.length} messages via Puppeteer+click`);
        messageCache.set(num.phone, { messages, time: Date.now() });
        return messages;
      }
    } catch (e) {
      log(`   ⚠️  Puppeteer+click failed: ${e.message}`);
    }
  }

  // Method 2: receive-sms.cc has clean HTML, just parse it
  if (num.source === 'receive-sms.cc') {
    try {
      const html = await fetchWithAxios(num.link);
      if (html) {
        const $ = cheerio.load(html);
        const messages = [];
        $('div.item').each((i, element) => {
          if (i >= 10) return false;
          const from = $(element).find('.form').text().trim();
          const time = $(element).find('.time').text().trim();
          const content = $(element).find('.con').text().trim();
          if (content) {
            messages.push({ from, time, content });
          }
        });
        if (messages.length > 0) {
          log(`   ✅ Got ${messages.length} messages via HTML parse`);
          messageCache.set(num.phone, { messages, time: Date.now() });
          return messages;
        }
      }
    } catch (e) {
      log(`   ⚠️  HTML parse failed: ${e.message}`);
    }
  }

  log(`   ❌ Could not fetch messages for ${num.phone}`);
  return null;
}

// Puppeteer that clicks the "Show SMS messages" button to bypass ad gate
async function fetchWithPuppeteerClick(url) {
  const launchOptions = {
    headless: 'new',  // new headless mode
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  };

  // If we found Chrome explicitly, use it
  if (CHROME_PATH) {
    launchOptions.executablePath = CHROME_PATH;
  }

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    log(`   🌐 Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for the page to load
    await new Promise(r => setTimeout(r, 2000));

    // Try to find and click the "Show SMS messages" button
    try {
      const buttonClicked = await page.evaluate(() => {
        // Find button by class or text
        const btn = document.querySelector('.sms-load-button') ||
                    document.querySelector('button[class*="sms-load"]') ||
                    Array.from(document.querySelectorAll('button')).find(b =>
                      b.textContent.includes('Show SMS') ||
                      b.textContent.includes('Load')
                    );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (buttonClicked) {
        log(`   🖱️  Clicked 'Show SMS messages' button`);
        // Wait for messages to load via API
        await new Promise(r => setTimeout(r, 5000));
      } else {
        log(`   ℹ️  No button found, checking if messages already loaded`);
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      log(`   ⚠️  Button click failed: ${e.message}`);
    }

    // Now extract the messages from the rendered page
    const messages = await page.evaluate(() => {
      const results = [];

      // Method 1: Look for messages in data-messages-list children
      const list = document.querySelector('[data-messages-list]');
      if (list) {
        const items = list.querySelectorAll(':scope > *');
        items.forEach(item => {
          const text = item.textContent.trim();
          if (text) {
            results.push({
              from: 'Service',
              time: 'Recent',
              content: text
            });
          }
        });
      }

      // Method 2: Look for any text containing "code" or numbers
      if (results.length === 0) {
        const allText = document.body.innerText;
        // Try to find code patterns
        const codeRegex = /(?:code|Code|CODE)[:\s]*(\d{4,8})/g;
        let match;
        while ((match = codeRegex.exec(allText)) !== null) {
          const start = Math.max(0, match.index - 50);
          const end = Math.min(allText.length, match.index + 100);
          const context = allText.substring(start, end).trim();
          if (context && !results.find(r => r.content === context)) {
            results.push({ from: 'Service', time: 'Recent', content: context });
            if (results.length >= 5) break;
          }
        }
      }

      return results.slice(0, 10);
    });

    return messages;
  } finally {
    await browser.close();
  }
}

// NEW: Call sms24.me's API directly - bypasses the ad gate completely!
async function fetchViaApi(num) {
  // num.link is like https://sms24.me/en/numbers/12393481596
  // We need to convert to: https://sms24.me/api/messages/12393481596
  const match = num.link.match(/\/numbers\/(\d+)/);
  if (!match) {
    throw new Error('Could not extract number from link');
  }
  const phoneNumber = match[1];
  const apiUrl = `https://sms24.me/api/messages/${phoneNumber}`;

  log(`   🔌 Calling API: ${apiUrl}`);

  // Try POST first (what the JS does)
  const response = await axios.post(apiUrl, {
    page: 1
  }, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/html, */*',
      'Accept-Language': 'en-US,en;q=0.5',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://sms24.me',
      'Referer': num.link
    },
    timeout: 30000
  });

  if (!response.data) {
    throw new Error('Empty response');
  }

  // Response structure: { messages: [{...}, {...}] }
  const rawMessages = response.data.messages || response.data.data || [];

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    log(`   API returned no messages`);
    return [];
  }

  // Normalize the messages
  const messages = rawMessages.slice(0, 10).map(m => {
    // Try to find the code in the message body
    const body = m.body || m.message || m.text || m.content || '';
    const codeMatch = body.match(/\d{4,8}/);
    const code = codeMatch ? codeMatch[0] : null;

    return {
      from: m.from || m.sender || m.service || 'Service',
      time: m.time || m.received_at || m.created_at || 'Recent',
      content: body,
      code: code
    };
  }).filter(m => m.content); // Only keep messages with content

  return messages;
}

// Puppeteer fetch (with retry)
async function fetchWithPuppeteer(url) {
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

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

// Axios fallback (lighter, no Chrome needed)
async function fetchWithAxios(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    },
    timeout: 30000,
    maxRedirects: 5
  });
  return response.data;
}

// Post a fresh code to channel
async function postToChannel(num, message) {
  try {
    const channelText = `📩 *New Code Received!*\n\n` +
                       `📞 \`${num.phone}\`\n` +
                       `🌍 ${num.country}\n` +
                       `🔐 Code/Message: "${message.content}"\n` +
                       `⏰ ${message.time}\n\n` +
                       `👇 @patrick_sms_bot`;

    await bot.sendMessage(CHANNEL, channelText, { parse_mode: 'Markdown' });
    log(`   📢 Posted to channel: ${num.phone}`);
    return true;
  } catch (error) {
    log(`   ❌ Channel post failed: ${error.message}`);
    return false;
  }
}

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'friend';

  await bot.sendMessage(chatId,
    `👋 Hey *${name}*!\n\n` +
    `Get free temporary phone numbers for SMS verification.\n\n` +
    `📊 ${data.length} numbers across ${getCountries().length} countries\n` +
    `🌍 Pick a country to start:`,
    { parse_mode: 'Markdown' }
  );

  await bot.sendMessage(chatId, '🌍 Choose:', {
    reply_markup: { inline_keyboard: countryKeyboard(0) }
  });
});

// Button handler
bot.on('callback_query', async (callback) => {
  const chatId = callback.message.chat.id;
  const dataId = callback.data;
  const messageId = callback.message.message_id;

  try {
    if (dataId.startsWith('page_')) {
      const page = parseInt(dataId.replace('page_', ''));
      await bot.answerCallbackQuery(callback.id, { text: `Page ${page + 1}` });
      await bot.editMessageText('🌍 Choose:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: countryKeyboard(page) }
      });
      return;
    }

    if (dataId === 'change_country') {
      await bot.answerCallbackQuery(callback.id, { text: '🌍 Pick a country' });
      await bot.sendMessage(chatId, '🌍 Choose:', {
        reply_markup: { inline_keyboard: countryKeyboard(0) }
      });
      return;
    }

    if (dataId.startsWith('pick_')) {
      const country = dataId.replace('pick_', '');
      const num = getRandomNumber(country);

      if (!num) {
        await bot.answerCallbackQuery(callback.id, { text: 'No numbers in that country' });
        return;
      }

      await bot.answerCallbackQuery(callback.id, { text: `📞 ${num.phone}` });

      const text = `📞 *${num.phone}*\n` +
                   `📩 ${num.smsCount} SMS total\n` +
                   `⏰ Last SMS: ${num.lastSms}\n\n` +
                   `👇 Tap *Get SMS* to load recent messages`;

      await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: numberKeyboard(num.phone)
      });
      return;
    }

    if (dataId.startsWith('new_')) {
      const oldPhone = dataId.replace('new_', '');
      const oldNum = data.find(n => n.phone === oldPhone);

      if (!oldNum) {
        await bot.answerCallbackQuery(callback.id, { text: 'Number not found' });
        return;
      }

      const newNum = getRandomNumber(oldNum.country);
      if (!newNum) {
        await bot.answerCallbackQuery(callback.id, { text: 'No more numbers' });
        return;
      }

      await bot.answerCallbackQuery(callback.id, { text: `📞 ${newNum.phone}` });

      const text = `📞 *${newNum.phone}*\n` +
                   `📩 ${newNum.smsCount} SMS total\n` +
                   `⏰ Last SMS: ${newNum.lastSms}\n\n` +
                   `👇 Tap *Get SMS* to load recent messages`;

      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: numberKeyboard(newNum.phone)
        });
      } catch (editError) {
        if (!editError.message.includes('not modified')) throw editError;
      }
      return;
    }

    // THE BIG ONE: Get SMS
    if (dataId.startsWith('sms_')) {
      const phone = dataId.replace('sms_', '');
      const num = data.find(n => n.phone === phone);

      if (!num) {
        await bot.answerCallbackQuery(callback.id, { text: 'Number not found' });
        return;
      }

      await bot.answerCallbackQuery(callback.id, { text: '📩 Loading...' });

      const messages = await fetchMessages(num);

      let text = `📞 *${num.phone}*\n` +
                 `📩 ${num.smsCount} SMS total\n` +
                 `⏰ Last SMS: ${num.lastSms}\n\n`;

      if (!messages || messages.length === 0) {
        text += `📩 *Recent messages:*\n_No messages found or failed to load._`;
      } else {
        // Check if FIRST message (most recent) is within FRESH_WINDOW_MINUTES
        const latest = messages[0];
        const minutesAgo = parseTimeAgo(latest.time);

        if (minutesAgo <= FRESH_WINDOW_MINUTES && minutesAgo !== Infinity) {
          // FRESH! Post to channel
          log(`   ✨ Fresh code detected for ${num.phone} (${latest.time})`);
          await postToChannel(num, latest);

          text += `📩 *Recent messages:*\n`;
          messages.slice(0, 5).forEach((m, i) => {
            text += `\n*${i + 1}.* ${m.from}\n`;
            if (m.time) text += `   _${m.time}_\n`;
            if (m.code) {
              text += `   🔐 Code: \`${m.code}\`\n`;
            }
            text += `   "${m.content.substring(0, 150)}${m.content.length > 150 ? '...' : ''}"\n`;
          });
          text += `\n✅ _Fresh code detected - posted to channel!_`;
        } else {
          // Too old
          text += `📩 *Recent messages:*\n`;
          messages.slice(0, 3).forEach((m, i) => {
            text += `\n*${i + 1}.* ${m.from}\n`;
            if (m.time) text += `   _${m.time}_\n`;
            if (m.code) {
              text += `   🔐 Code: \`${m.code}\`\n`;
            }
            text += `   "${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}"\n`;
          });
          text += `\n⚠️ _No new code in the last ${FRESH_WINDOW_MINUTES} minutes. Try again later._`;
        }
      }

      text += `\n🔗 [View full inbox](${num.link})`;

      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: numberKeyboard(phone)
        });
      } catch (editError) {
        // If message is not modified, that's okay - just send a fresh one
        if (!editError.message.includes('not modified')) {
          throw editError;
        }
        log(`   Message not modified, ignoring`);
      }
      return;
    }
  } catch (error) {
    log(`Callback error: ${error.message}`);
    try {
      await bot.answerCallbackQuery(callback.id, { text: 'Something went wrong' });
    } catch (e) {}
  }
});

bot.onText(/\/refresh/, async (msg) => {
  await loadData();
  messageCache.clear();
  bot.sendMessage(msg.chat.id, `✅ Reloaded ${data.length} numbers`);
});

bot.onText(/\/scrape/, async (msg) => {
  await runScraperAndReload(msg.chat.id);
});

bot.onText(/^[.!]?scrape\b/i, async (msg) => {
  await runScraperAndReload(msg.chat.id);
});

bot.onText(/\/stats/, async (msg) => {
  const countries = getCountries();
  const status = await supabaseStore.status();
  let stats = `📊 *Bot Statistics*\n\n`;
  stats += `📞 Total: ${data.length}\n`;
  stats += `🌍 Countries: ${countries.length}\n`;
  stats += `⏰ Fresh window: ${FRESH_WINDOW_MINUTES} minutes\n`;
  stats += `💾 Storage: ${status.storage}\n`;
  stats += `📅 Stale: ${status.stale ? '⚠️ yes' : '✅ no'}\n`;
  if (status.lastUpdate) {
    stats += `🕐 Last update: ${new Date(status.lastUpdate).toLocaleString()}\n`;
  }
  stats += `\n*Numbers per country:*\n`;

  const sorted = countries
    .map(c => ({ name: c, count: getCountryCount(c) }))
    .sort((a, b) => b.count - a.count);

  sorted.forEach(c => {
    stats += `${c.name}: ${c.count}\n`;
  });

  stats += `\n*Commands:*\n`;
  stats += `/scrape - Run scraper now\n`;
  stats += `/refresh - Reload from storage\n`;
  stats += `/stats - This message`;

  bot.sendMessage(msg.chat.id, stats, { parse_mode: 'Markdown' });
});

bot.onText(/\/post/, async (msg) => {
  if (data.length === 0) {
    bot.sendMessage(msg.chat.id, '❌ No data');
    return;
  }

  const countries = getCountries().slice(0, 5);
  let post = '📱 *Fresh Numbers!*\n\n';

  for (const country of countries) {
    const num = getRandomNumber(country);
    if (num) {
      post += `📞 \`${num.phone}\`\n`;
      post += `🌍 ${num.country}\n\n`;
    }
  }

  post += `👇 @patrick_sms_bot`;

  try {
    await bot.sendMessage(CHANNEL, post, { parse_mode: 'Markdown' });
    bot.sendMessage(msg.chat.id, '✅ Posted!');
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ ${error.message}`);
  }
});

log('🤖 Bot started!');
log(`📊 ${data.length} numbers, ${getCountries().length} countries`);
log(`⏰ Fresh window: ${FRESH_WINDOW_MINUTES} minutes`);

// Auto-reload + check for staleness every 2 minutes
const RELOAD_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
setInterval(async () => {
  const oldCount = data.length;
  await loadData();
  messageCache.clear();
  if (data.length !== oldCount) {
    log(`🔄 Auto-reload: ${oldCount} → ${data.length} numbers`);
  }
  // Check if data is stale and auto-refresh
  const stale = await supabaseStore.isStale();
  if (stale && data.length > 0) {
    log('⚠️  Data is stale, triggering auto re-scrape...');
    try {
      const newNumbers = await scrapeAll();
      if (newNumbers && newNumbers.length > 0) {
        await supabaseStore.saveNumbers(newNumbers);
        await loadData();
        log(`✅ Auto re-scrape saved ${newNumbers.length} numbers`);
      }
    } catch (e) {
      log(`❌ Auto re-scrape failed: ${e.message}`);
    }
  }
}, RELOAD_INTERVAL_MS);
log(`🔄 Auto-reload + stale check every ${RELOAD_INTERVAL_MS / 1000}s`);
