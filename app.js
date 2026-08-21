// app.js
// Main entry: serves mini-website + runs scraper + starts bot
// For Render Web Service deployment

const express = require('express');
const { scrapeAll } = require('./scraper-sms24');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

let botProcess = null;
let lastScrape = null;
let scrapingStatus = 'idle';
let totalNumbers = 0;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function countNumbers() {
  try {
    if (fs.existsSync('data-sms24.json')) {
      const data = JSON.parse(fs.readFileSync('data-sms24.json', 'utf-8'));
      return data.length;
    }
  } catch (e) {}
  return 0;
}

// =================== WEBSITE ===================

app.get('/', (req, res) => {
  totalNumbers = countNumbers();
  const uptime = process.uptime();
  const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📱 Free SMS Numbers Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #fff;
    }
    .container {
      max-width: 600px;
      width: 100%;
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    }
    h1 { font-size: 2.5em; margin-bottom: 10px; }
    .subtitle { opacity: 0.9; margin-bottom: 30px; }
    .status-card {
      background: rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 20px;
      margin: 15px 0;
    }
    .status-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .status-row:last-child { border-bottom: none; }
    .label { opacity: 0.8; }
    .value { font-weight: bold; }
    .green { color: #4ade80; }
    .yellow { color: #fbbf24; }
    .btn {
      display: inline-block;
      background: #fff;
      color: #667eea;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: bold;
      margin: 10px 10px 0 0;
      transition: transform 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
    .emoji { font-size: 4em; text-align: center; margin-bottom: 20px; }
    .footer { text-align: center; margin-top: 30px; opacity: 0.7; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <div class="emoji">📱</div>
    <h1>Free SMS Numbers Bot</h1>
    <p class="subtitle">Get free temporary phone numbers for SMS verification</p>

    <div class="status-card">
      <div class="status-row">
        <span class="label">🤖 Bot Status</span>
        <span class="value green">● Online</span>
      </div>
      <div class="status-row">
        <span class="label">📊 Total Numbers</span>
        <span class="value">${totalNumbers}</span>
      </div>
      <div class="status-row">
        <span class="label">🔄 Scraper Status</span>
        <span class="value ${scrapingStatus === 'running' ? 'yellow' : 'green'}">${scrapingStatus}</span>
      </div>
      <div class="status-row">
        <span class="label">⏰ Uptime</span>
        <span class="value">${uptimeStr}</span>
      </div>
      <div class="status-row">
        <span class="label">📅 Last Scrape</span>
        <span class="value">${lastScrape || 'Just started'}</span>
      </div>
    </div>

    <a href="https://t.me/patrick_sms_bot" class="btn">🤖 Open in Telegram</a>
    <a href="/ping" class="btn">📡 Ping</a>
    <a href="/stats" class="btn">📊 Stats</a>

    <div class="footer">
      Powered by Render • Scraping sms24.me<br>
      Made with 💯 by @phantom-dev-x
    </div>
  </div>
</body>
</html>
  `);
});

app.get('/ping', (req, res) => {
  res.json({
    status: 'alive',
    uptime: process.uptime(),
    numbers: countNumbers(),
    scraper: scrapingStatus,
    timestamp: new Date().toISOString()
  });
});

app.get('/stats', (req, res) => {
  try {
    let data = [];
    if (fs.existsSync('data-sms24.json')) {
      data = JSON.parse(fs.readFileSync('data-sms24.json', 'utf-8'));
    }
    if (fs.existsSync('data.json')) {
      const r2 = JSON.parse(fs.readFileSync('data.json', 'utf-8'));
      data = data.concat(r2);
    }

    const countries = {};
    data.forEach(n => {
      countries[n.country] = (countries[n.country] || 0) + 1;
    });

    res.json({
      total: data.length,
      countries: Object.keys(countries).length,
      breakdown: countries,
      uptime: process.uptime(),
      scraper: scrapingStatus,
      last_scrape: lastScrape
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/rescrape', async (req, res) => {
  if (scrapingStatus === 'running') {
    return res.json({ status: 'already running' });
  }
  res.json({ status: 'started' });
  runScraper();
});

// =================== SCRAPER ===================

async function runScraper() {
  if (scrapingStatus === 'running') {
    log('⚠️  Scraper already running, skipping');
    return;
  }
  scrapingStatus = 'running';
  log('🔄 Starting scraper...');
  try {
    await scrapeAll();
    lastScrape = new Date().toISOString();
    totalNumbers = countNumbers();
    log(`✅ Scraper done. Total: ${totalNumbers} numbers`);
  } catch (err) {
    log(`❌ Scraper failed: ${err.message}`);
  } finally {
    scrapingStatus = 'idle';
  }
}

// =================== BOT ===================

function startBot() {
  log('🤖 Starting Telegram bot...');
  botProcess = spawn('node', ['bot.js'], {
    stdio: 'inherit',
    env: process.env
  });

  botProcess.on('error', (err) => {
    log(`❌ Bot crashed: ${err.message}`);
    setTimeout(startBot, 5000);
  });

  botProcess.on('exit', (code) => {
    log(`⚠️  Bot exited with code ${code}, restarting...`);
    setTimeout(startBot, 5000);
  });
}

// =================== MAIN ===================

async function main() {
  log('🚀 APP STARTING (Web Service mode)');

  // Start the website
  app.listen(PORT, () => {
    log(`🌐 Website running on port ${PORT}`);
  });

  // Run scraper on startup
  if (process.env.RUN_SCRAPER_ON_START !== 'false') {
    log('🔄 Running initial scraper...');
    runScraper();
  }

  // Start the bot
  startBot();

  // Re-scrape every 6 hours
  const hours = parseInt(process.env.SCRAPE_INTERVAL_HOURS || '6');
  setInterval(runScraper, hours * 60 * 60 * 1000);
  log(`⏰ Auto re-scrape every ${hours} hours`);
}

main().catch(err => {
  log(`❌ FATAL: ${err.message}`);
  process.exit(1);
});
