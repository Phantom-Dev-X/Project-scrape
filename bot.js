// bot.js
// Telegram bot for free SMS numbers
// Reads from data-sms24.json (and optionally data.json from receive-sms.cc)
// Token is loaded from environment variable (set in Render dashboard)
// FEATURE: Posts fresh codes (< 5 min) to channel

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

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

// Load data from files
let data = [];
function loadData() {
  let combined = [];

  // Load receive-sms.cc data (PRIMARY - has visible time stamps)
  try {
    const r1 = JSON.parse(fs.readFileSync('data.json', 'utf-8'));
    const cleaned1 = r1.map(n => ({
      ...n,
      country: n.country.replace(' Phone Number', ''),
      source: 'receive-sms.cc'
    }));
    combined = combined.concat(cleaned1);
    console.log(`📂 Loaded ${r1.length} from data.json`);
  } catch (e) {
    // data.json is optional
  }

  // Load sms24.me data
  try {
    const r2 = JSON.parse(fs.readFileSync('data-sms24.json', 'utf-8'));
    combined = combined.concat(r2);
    console.log(`📂 Loaded ${r2.length} from data-sms24.json`);
  } catch (e) {
    // not required
  }

  // Remove duplicates
  const seen = new Set();
  combined = combined.filter(n => {
    if (seen.has(n.phone)) return false;
    seen.add(n.phone);
    return true;
  });

  data = combined;
  console.log(`📊 Total unique numbers: ${data.length}`);
}
loadData();

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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
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

bot.onText(/\/refresh/, (msg) => {
  loadData();
  messageCache.clear();
  bot.sendMessage(msg.chat.id, `✅ Reloaded ${data.length} numbers`);
});

bot.onText(/\/stats/, (msg) => {
  const countries = getCountries();
  let stats = `📊 *Bot Statistics*\n\n`;
  stats += `📞 Total: ${data.length}\n`;
  stats += `🌍 Countries: ${countries.length}\n`;
  stats += `⏰ Fresh window: ${FRESH_WINDOW_MINUTES} minutes\n\n`;
  stats += `*Top 10 countries:*\n`;

  const sorted = countries
    .map(c => ({ name: c, count: getCountryCount(c) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  sorted.forEach(c => {
    stats += `${c.name}: ${c.count}\n`;
  });

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
