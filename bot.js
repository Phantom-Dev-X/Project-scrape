// bot.js
// Telegram bot for free SMS numbers
// Reads from Supabase (persistent) with local file fallback
// Auto-runs scraper if data is stale
// Token is loaded from environment variable (set in Render dashboard)
// FEATURE: Posts fresh codes (< 5 min) to channel

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const supabaseStore = require('./supabase-store');
const { scrapeAll } = require('./scraper-sms24');

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
async function runScraperAndReload(chatId = null) {
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

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    await page.goto(num.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    const $ = cheerio.load(html);

    const messages = [];

    if (num.source === 'receive-sms.cc') {
      // receive-sms.cc has clean structure: .form, .time, .con
      $('div.item').each((i, element) => {
        if (i >= 10) return false;  // grab up to 10 for flexibility
        const from = $(element).find('.form').text().trim();
        const time = $(element).find('.time').text().trim();
        const content = $(element).find('.con').text().trim();
        if (content) {
          messages.push({ from, time, content });
        }
      });
    } else {
      // sms24.me fallback
      const allText = $('body').text();
      const codeRegex = /(?:code|Code|CODE)[:\s]*(\d{4,8})/g;
      let match;
      while ((match = codeRegex.exec(allText)) !== null && messages.length < 5) {
        const start = Math.max(0, match.index - 50);
        const end = Math.min(allText.length, match.index + 100);
        const context = allText.substring(start, end).trim();
        messages.push({ from: 'Service', time: 'Unknown', content: context });
      }
    }

    log(`   ✅ Got ${messages.length} messages`);
    messageCache.set(num.phone, { messages, time: Date.now() });
    return messages;
  } catch (error) {
    log(`   ❌ Failed: ${error.message}`);
    return null;
  } finally {
    await browser.close();
  }
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

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: numberKeyboard(newNum.phone)
      });
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
            text += `   "${m.content}"\n`;
          });
          text += `\n✅ _Fresh code detected - posted to channel!_`;
        } else {
          // Too old
          text += `📩 *Recent messages:*\n`;
          messages.slice(0, 3).forEach((m, i) => {
            text += `\n*${i + 1}.* ${m.from}\n`;
            if (m.time) text += `   _${m.time}_\n`;
            text += `   "${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}"\n`;
          });
          text += `\n⚠️ _No new code received in the last ${FRESH_WINDOW_MINUTES} minutes. Wait and try again._`;
        }
      }

      text += `\n🔗 [View full inbox](${num.link})`;

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: numberKeyboard(phone)
      });
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
