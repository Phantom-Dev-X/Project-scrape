// app.js
// Main entry: web server + scraper + Telegram bot + self-pinger
// All in ONE process (no child spawn - fixes Chrome path issues)

const express = require('express');
const { scrapeAll } = require('./scraper-sms24');
const fs = require('fs');
const https = require('https');
const http = require('http');
const supabaseStore = require('./supabase-store');

const PORT = process.env.PORT || 10000;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ====================================================
// 1. CHROME PATH FINDER (must be first, before puppeteer)
// ====================================================

function findChromePath() {
  // 1. Check environment variable
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  // 2. Check common Puppeteer cache locations
  const possiblePaths = [
    '/opt/render/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome',
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch (e) {}
  }

  // 3. Scan cache directory for any chrome version
  const cacheDirs = [
    '/opt/render/.cache/puppeteer/chrome',
    '/root/.cache/puppeteer/chrome',
    `${process.env.HOME || '/root'}/.cache/puppeteer/chrome`
  ];

  for (const cacheDir of cacheDirs) {
    try {
      if (fs.existsSync(cacheDir)) {
        const versions = fs.readdirSync(cacheDir);
        for (const ver of versions) {
          const chromePath = `${cacheDir}/${ver}/chrome-linux64/chrome`;
          if (fs.existsSync(chromePath)) {
            return chromePath;
          }
        }
      }
    } catch (e) {}
  }

  return null;
}

// Install Chrome if missing (self-heal at startup)
async function ensureChromeInstalled() {
  if (CHROME_PATH) {
    log(`✅ Found Chrome at: ${CHROME_PATH}`);
    return CHROME_PATH;
  }

  log('⚠️  Chrome not found, attempting to install...');

  const { execSync } = require('child_process');
  try {
    log('   Running: npx puppeteer browsers install chrome');
    execSync('npx puppeteer browsers install chrome', {
      stdio: 'inherit',
      timeout: 180000  // 3 min max
    });
    log('   ✅ Chrome installed!');
    return findChromePath();
  } catch (e) {
    log(`   ❌ Chrome install failed: ${e.message}`);
    return null;
  }
}

let CHROME_PATH = findChromePath();

// ====================================================
// 2. LOAD TELEGRAM BOT
// ====================================================

const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');

const token = process.env.BOT_TOKEN;
const CHANNEL = process.env.CHANNEL_USERNAME || '@tmpsms';

if (!token) {
  log('❌ BOT_TOKEN environment variable is not set!');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const FRESH_WINDOW_MINUTES = 5;

// ====================================================
// 3. DATA LOADING FROM SUPABASE
// ====================================================

let data = [];
let isLoading = false;

async function loadData() {
  if (isLoading) return;
  isLoading = true;
  try {
    data = await supabaseStore.getAllNumbers();
    log(`📂 Loaded ${data.length} numbers from ${supabaseStore.isEnabled() ? 'Supabase' : 'local file'}`);
  } catch (e) {
    log(`❌ Load error: ${e.message}`);
    data = [];
  } finally {
    isLoading = false;
  }
}

async function ensureFreshData() {
  if (data.length === 0) {
    log('⚠️  No data, running scraper...');
    const newNumbers = await scrapeAll();
    if (newNumbers && newNumbers.length > 0) {
      await supabaseStore.saveNumbers(newNumbers);
      await loadData();
    }
    return;
  }
  const stale = await supabaseStore.isStale();
  if (stale) {
    log('🔄 Data is stale, re-scraping...');
    const newNumbers = await scrapeAll();
    if (newNumbers && newNumbers.length > 0) {
      await supabaseStore.saveNumbers(newNumbers);
      await loadData();
    }
  }
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

function parseTimeAgo(timeStr) {
  if (!timeStr) return Infinity;
  const match = timeStr.toLowerCase().match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return Infinity;
  const num = parseInt(match[1]);
  const unit = match[2];
  const mults = { second: 1/60, minute: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 };
  return num * (mults[unit] || Infinity);
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
    row.push({ text: `${countries[i]} (${getCountryCount(countries[i])})`, callback_data: `pick_${countries[i]}` });
    if (countries[i + 1]) {
      row.push({ text: `${countries[i + 1]} (${getCountryCount(countries[i + 1])})`, callback_data: `pick_${countries[i + 1]}` });
    }
    buttons.push(row);
  }

  const navRow = [];
  if (page > 0) navRow.push({ text: '⬅️ Previous', callback_data: `page_${page - 1}` });
  if (page < totalPages - 1) navRow.push({ text: 'Next ➡️', callback_data: `page_${page + 1}` });
  if (navRow.length > 0) buttons.push(navRow);

  return buttons;
}

const messageCache = new Map();
const CACHE_TTL = 30 * 1000;

// ====================================================
// 4. FETCH MESSAGES (with Puppeteer button click)
// ====================================================

async function fetchWithPuppeteerClick(url) {
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  };

  if (CHROME_PATH) {
    launchOptions.executablePath = CHROME_PATH;
    log(`   🚀 Using Chrome: ${CHROME_PATH}`);
  } else {
    log(`   ⚠️  No CHROME_PATH set, trying Puppeteer defaults`);
  }

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    log(`   🌐 Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // Click the "Show SMS messages" button - then wait for messages to appear
    try {
      const buttonClicked = await page.evaluate(() => {
        const btn = document.querySelector('.sms-load-button') ||
                    document.querySelector('button[class*="sms-load"]') ||
                    Array.from(document.querySelectorAll('button')).find(b =>
                      b.textContent.includes('Show SMS') || b.textContent.includes('Load')
                    );
        if (btn) { btn.click(); return true; }
        return false;
      });

      if (buttonClicked) {
        log(`   🖱️  Clicked 'Show SMS messages' button`);

        // Wait for messages to actually appear in the DOM (poll every 1s for up to 30s)
        let messagesLoaded = false;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const count = await page.evaluate(() => {
            const list = document.querySelector('[data-messages-list]');
            if (!list) return 0;
            return list.querySelectorAll(':scope > *').length;
          });
          if (count > 0) {
            log(`   📩 Messages appeared after ${i + 1}s (${count} items)`);
            messagesLoaded = true;
            break;
          }
        }

        if (!messagesLoaded) {
          log(`   ⚠️  Messages didn't appear after 30s, trying to extract anyway`);
        }
      } else {
        log(`   ℹ️  No button found`);
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      log(`   ⚠️  Button click failed: ${e.message}`);
    }

    const messages = await page.evaluate(() => {
      const results = [];
      const list = document.querySelector('[data-messages-list]');
      if (list) {
        list.querySelectorAll(':scope > *').forEach(item => {
          const text = item.textContent.trim();
          if (text) {
            // Try to extract structured data
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            const from = lines[0] || 'Service';
            const time = lines.find(l => /\d+\s+(minute|hour|day|month|year|second)s?\s+ago/i.test(l)) || 'Recent';
            const content = lines.filter(l => l !== from && l !== time).join(' ').trim() || text;

            results.push({ from, time, content });
          }
        });
      }
      if (results.length === 0) {
        const allText = document.body.innerText;
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

async function fetchWithAxios(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive'
    },
    timeout: 30000,
    maxRedirects: 5
  });
  return response.data;
}

async function fetchMessages(num) {
  if (!num || !num.link) return null;

  const cached = messageCache.get(num.phone);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.messages;
  }

  log(`📩 Fetching SMS for ${num.phone} (source: ${num.source})...`);

  if (num.source === 'sms24.me') {
    try {
      const messages = await fetchWithPuppeteerClick(num.link);
      if (messages && messages.length > 0) {
        log(`   ✅ Got ${messages.length} messages`);
        messageCache.set(num.phone, { messages, time: Date.now() });
        return messages;
      }
    } catch (e) {
      log(`   ⚠️  Puppeteer failed: ${e.message}`);
    }
  }

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
          if (content) messages.push({ from, time, content });
        });
        if (messages.length > 0) {
          log(`   ✅ Got ${messages.length} messages via HTML`);
          messageCache.set(num.phone, { messages, time: Date.now() });
          return messages;
        }
      }
    } catch (e) {
      log(`   ⚠️  HTML parse failed: ${e.message}`);
    }
  }

  log(`   ❌ Could not fetch messages`);
  return null;
}

async function postToChannel(num, message) {
  try {
    const channelText = `📩 *New Code Received!*\n\n` +
                       `📞 \`${num.phone}\`\n` +
                       `🌍 ${num.country}\n` +
                       `🔐 Code/Message: "${message.content}"\n` +
                       `⏰ ${message.time}\n\n` +
                       `👇 @patrick_sms_bot`;
    await bot.sendMessage(CHANNEL, channelText, { parse_mode: 'Markdown' });
    log(`   📢 Posted to channel`);
    return true;
  } catch (error) {
    log(`   ❌ Channel post failed: ${error.message}`);
    return false;
  }
}

// ====================================================
// 5. TELEGRAM BOT HANDLERS
// ====================================================

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

bot.on('callback_query', async (callback) => {
  const chatId = callback.message.chat.id;
  const dataId = callback.data;
  const messageId = callback.message.message_id;

  try {
    if (dataId.startsWith('page_')) {
      const page = parseInt(dataId.replace('page_', ''));
      await bot.answerCallbackQuery(callback.id, { text: `Page ${page + 1}` });
      await bot.editMessageText('🌍 Choose:', {
        chat_id: chatId, message_id: messageId,
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
        await bot.answerCallbackQuery(callback.id, { text: 'No numbers' });
        return;
      }
      await bot.answerCallbackQuery(callback.id, { text: `📞 ${num.phone}` });
      await bot.sendMessage(chatId,
        `📞 *${num.phone}*\n📩 ${num.smsCount} SMS total\n⏰ Last SMS: ${num.lastSms}\n\n👇 Tap *Get SMS* to load recent messages`,
        { parse_mode: 'Markdown', reply_markup: numberKeyboard(num.phone) }
      );
      return;
    }

    if (dataId.startsWith('new_')) {
      const oldPhone = dataId.replace('new_', '');
      const oldNum = data.find(n => n.phone === oldPhone);
      if (!oldNum) {
        await bot.answerCallbackQuery(callback.id, { text: 'Not found' });
        return;
      }
      const newNum = getRandomNumber(oldNum.country);
      if (!newNum) {
        await bot.answerCallbackQuery(callback.id, { text: 'No more' });
        return;
      }
      await bot.answerCallbackQuery(callback.id, { text: `📞 ${newNum.phone}` });
      try {
        await bot.editMessageText(
          `📞 *${newNum.phone}*\n📩 ${newNum.smsCount} SMS total\n⏰ Last SMS: ${newNum.lastSms}\n\n👇 Tap *Get SMS* to load recent messages`,
          {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: numberKeyboard(newNum.phone)
          }
        );
      } catch (e) {
        if (!e.message.includes('not modified')) throw e;
      }
      return;
    }

    if (dataId.startsWith('sms_')) {
      const phone = dataId.replace('sms_', '');
      const num = data.find(n => n.phone === phone);
      if (!num) {
        await bot.answerCallbackQuery(callback.id, { text: 'Not found' });
        return;
      }

      await bot.answerCallbackQuery(callback.id, { text: '📩 Loading...' });
      const messages = await fetchMessages(num);

      let text = `📞 *${num.phone}*\n📩 ${num.smsCount} SMS total\n⏰ Last SMS: ${num.lastSms}\n\n`;

      if (!messages || messages.length === 0) {
        text += `📩 *Recent messages:*\n_No messages found. Tap the link below to view the inbox yourself._`;
      } else {
        const latest = messages[0];
        const minutesAgo = parseTimeAgo(latest.time);

        if (minutesAgo <= FRESH_WINDOW_MINUTES && minutesAgo !== Infinity) {
          log(`   ✨ Fresh code (${latest.time})`);
          await postToChannel(num, latest);

          text += `📩 *Recent messages:*\n`;
          messages.slice(0, 5).forEach((m, i) => {
            text += `\n*${i + 1}.* ${m.from}\n`;
            if (m.time) text += `   _${m.time}_\n`;
            if (m.code) text += `   🔐 Code: \`${m.code}\`\n`;
            text += `   "${m.content.substring(0, 150)}${m.content.length > 150 ? '...' : ''}"\n`;
          });
          text += `\n✅ _Fresh code - posted to channel!_`;
        } else {
          text += `📩 *Recent messages:*\n`;
          messages.slice(0, 3).forEach((m, i) => {
            text += `\n*${i + 1}.* ${m.from}\n`;
            if (m.time) text += `   _${m.time}_\n`;
            if (m.code) text += `   🔐 Code: \`${m.code}\`\n`;
            text += `   "${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}"\n`;
          });
          text += `\n⚠️ _No new code in last ${FRESH_WINDOW_MINUTES} min._`;
        }
      }

      text += `\n🔗 [View full inbox](${num.link})`;

      try {
        await bot.editMessageText(text, {
          chat_id: chatId, message_id: messageId,
          parse_mode: 'Markdown', reply_markup: numberKeyboard(phone)
        });
      } catch (e) {
        if (!e.message.includes('not modified')) throw e;
      }
      return;
    }
  } catch (error) {
    log(`Callback error: ${error.message}`);
    try { await bot.answerCallbackQuery(callback.id, { text: 'Error' }); } catch (e) {}
  }
});

bot.onText(/\/refresh/, async (msg) => {
  await loadData();
  messageCache.clear();
  bot.sendMessage(msg.chat.id, `✅ Reloaded ${data.length} numbers`);
});

bot.onText(/\/scrape|^\.scrape\b/i, async (msg) => {
  const statusMsg = await bot.sendMessage(msg.chat.id, '🔄 Running scraper...');
  try {
    const newNumbers = await scrapeAll();
    if (newNumbers && newNumbers.length > 0) {
      const result = await supabaseStore.saveNumbers(newNumbers);
      await loadData();
      await bot.editMessageText(
        `✅ Scrape complete! Saved ${result.saved} numbers`,
        { chat_id: msg.chat.id, message_id: statusMsg.message_id }
      );
    } else {
      await bot.editMessageText('⚠️ Scraper returned 0 numbers', {
        chat_id: msg.chat.id, message_id: statusMsg.message_id
      });
    }
  } catch (e) {
    await bot.editMessageText(`❌ Scrape failed: ${e.message}`, {
      chat_id: msg.chat.id, message_id: statusMsg.message_id
    });
  }
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
      post += `📞 \`${num.phone}\`\n🌍 ${num.country}\n\n`;
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

log('🤖 Bot started (in-process)');
log(`📊 ${data.length} numbers, ${getCountries().length} countries`);

// Auto-reload + check for staleness every 2 minutes
setInterval(async () => {
  await loadData();
  messageCache.clear();
  const stale = await supabaseStore.isStale();
  if (stale && data.length > 0) {
    log('⚠️  Data stale, auto re-scraping...');
    try {
      const newNumbers = await scrapeAll();
      if (newNumbers && newNumbers.length > 0) {
        await supabaseStore.saveNumbers(newNumbers);
        await loadData();
        log(`✅ Auto re-scrape saved ${newNumbers.length}`);
      }
    } catch (e) {
      log(`❌ Auto re-scrape failed: ${e.message}`);
    }
  }
}, 2 * 60 * 1000);

// ====================================================
// 6. WEB SERVER
// ====================================================

const app = express();
let scrapingStatus = 'idle';
let lastScrape = null;
let totalNumbers = 0;
let pingCount = 0;
let lastPingTime = null;

async function countNumbers() {
  return await supabaseStore.getCount();
}

app.get('/', async (req, res) => {
  totalNumbers = await countNumbers();
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>📱 SMS Bot</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#fff}.container{max-width:600px;width:100%;background:rgba(255,255,255,0.1);backdrop-filter:blur(10px);border-radius:20px;padding:40px}h1{font-size:2.5em;margin-bottom:10px;text-align:center}.status-card{background:rgba(255,255,255,0.15);border-radius:12px;padding:20px;margin:15px 0}.status-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1)}.status-row:last-child{border-bottom:none}.value{font-weight:bold}.green{color:#4ade80}.btn{display:inline-block;background:#fff;color:#667eea;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:10px 10px 0 0}.emoji{font-size:4em;text-align:center;margin-bottom:20px}.footer{text-align:center;margin-top:30px;opacity:0.7;font-size:0.9em}</style>
</head><body><div class="container"><div class="emoji">📱</div><h1>Free SMS Bot</h1><p style="text-align:center;opacity:0.9;margin-bottom:30px">Temporary phone numbers for SMS verification</p>
<div class="status-card"><div class="status-row"><span>🤖 Bot</span><span class="value green">● Online</span></div>
<div class="status-row"><span>📊 Numbers</span><span class="value">${totalNumbers}</span></div>
<div class="status-row"><span>⏰ Uptime</span><span class="value">${hours}h ${minutes}m</span></div>
<div class="status-row"><span>📅 Last Scrape</span><span class="value">${lastScrape ? new Date(lastScrape).toLocaleString() : 'Just started'}</span></div>
<div class="status-row"><span>🔄 Self-Pings</span><span class="value">${pingCount}</span></div></div>
<div style="text-align:center"><a href="https://t.me/patrick_sms_bot" class="btn">🤖 Open Bot</a>
<a href="/ping" class="btn">📡 Ping</a><a href="/stats" class="btn">📊 Stats</a></div>
<div class="footer">Powered by Render • ${CHROME_PATH ? '✅ Chrome ready' : '⚠️ Chrome missing'}</div></div></body></html>`);
});

app.get('/ping', async (req, res) => {
  res.json({
    status: 'alive',
    uptime: Math.floor(process.uptime()),
    numbers: await countNumbers(),
    scraper: scrapingStatus,
    chrome: CHROME_PATH || 'missing',
    self_pings: pingCount,
    last_self_ping: lastPingTime
  });
});

app.get('/stats', async (req, res) => {
  try {
    const d = await supabaseStore.getAllNumbers();
    const status = await supabaseStore.status();
    const countries = {};
    d.forEach(n => { countries[n.country] = (countries[n.country] || 0) + 1; });
    res.json({
      total: d.length,
      countries: Object.keys(countries).length,
      breakdown: countries,
      chrome: CHROME_PATH || 'missing',
      storage: status.storage
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====================================================
// 7. SCRAPER (called internally)
// ====================================================

async function runScraper() {
  if (scrapingStatus === 'running') {
    log('⚠️  Scraper already running');
    return;
  }
  scrapingStatus = 'running';
  log('🔄 ============ STARTING SCRAPER ============');
  try {
    const newNumbers = await scrapeAll();
    if (newNumbers && newNumbers.length > 0) {
      await supabaseStore.saveNumbers(newNumbers);
      log(`💾 Saved ${newNumbers.length} numbers`);
    }
    lastScrape = new Date().toISOString();
    totalNumbers = await countNumbers();
    log(`✅ Scraper done. Total: ${totalNumbers}`);
  } catch (err) {
    log(`❌ Scraper error: ${err.message}`);
  } finally {
    scrapingStatus = 'idle';
  }
}

// ====================================================
// 8. SELF-PINGER
// ====================================================

function selfPing() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  pingCount++;
  lastPingTime = new Date().toISOString();
  const lib = url.startsWith('https') ? https : http;
  lib.get(url, { timeout: 10000 }, (res) => {
    log(`📡 Self-ping #${pingCount}: ${res.statusCode} (${Date.now() - new Date(lastPingTime).getTime()}ms)`);
    res.resume();
  }).on('error', (err) => {
    log(`⚠️  Self-ping failed: ${err.message}`);
  });
}

setTimeout(() => {
  selfPing();
  setInterval(selfPing, 10 * 60 * 1000);
}, 30000);

// ====================================================
// 9. MAIN
// ====================================================

async function main() {
  log('🚀 ============================================');
  log('🚀 ALL-IN-ONE: web + scraper + bot + self-ping');
  log('🚀 ============================================');

  // Ensure Chrome is installed (self-heal if missing)
  CHROME_PATH = await ensureChromeInstalled();

  // Load data + start bot
  await loadData();
  await ensureFreshData();

  // Start web server
  app.listen(PORT, '0.0.0.0', () => {
    log(`🌐 Website LIVE on port ${PORT}`);
  });

  // Start scraper after 5 seconds
  if (process.env.RUN_SCRAPER_ON_START !== 'false') {
    setTimeout(() => runScraper().catch(err => log(`❌ Initial scrape: ${err.message}`)), 5000);
  }

  // Auto re-scrape every 6 hours
  setInterval(() => {
    runScraper().catch(err => log(`❌ Re-scrape: ${err.message}`));
  }, 6 * 60 * 60 * 1000);

  log('✅ APP READY');
}

main().catch(err => {
  log(`❌ FATAL: ${err.message}`);
  process.exit(1);
});
