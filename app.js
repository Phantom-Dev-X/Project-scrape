// app.js
// Main entry: runs scraper FIRST (waits for it), then starts web + bot
// Also self-pings to keep Render free tier awake

const express = require('express');
const { scrapeAll } = require('./scraper-sms24');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const supabaseStore = require('./supabase-store');

const app = express();
const PORT = process.env.PORT || 3000;

let botProcess = null;
let lastScrape = null;
let scrapingStatus = 'idle';
let totalNumbers = 0;
let appStartedAt = new Date();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function countNumbers() {
  return await supabaseStore.getCount();
}

// =================== WEBSITE ===================

app.get('/', async (req, res) => {
  totalNumbers = await countNumbers();
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

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
    h1 { font-size: 2.5em; margin-bottom: 10px; text-align: center; }
    .subtitle { opacity: 0.9; margin-bottom: 30px; text-align: center; }
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
    .label { opacity: 0.85; }
    .value { font-weight: bold; }
    .green { color: #4ade80; }
    .yellow { color: #fbbf24; }
    .red { color: #f87171; }
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
    <h1>Free SMS Bot</h1>
    <p class="subtitle">Temporary phone numbers for SMS verification</p>

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
        <span class="label">🔄 Scraper</span>
        <span class="value ${scrapingStatus === 'running' ? 'yellow' : 'green'}">${scrapingStatus}</span>
      </div>
      <div class="status-row">
        <span class="label">⏰ Uptime</span>
        <span class="value">${hours}h ${minutes}m</span>
      </div>
      <div class="status-row">
        <span class="label">📅 Last Scrape</span>
        <span class="value">${lastScrape ? new Date(lastScrape).toLocaleString() : 'Just started'}</span>
      </div>
    </div>

    <div style="text-align: center;">
      <a href="https://t.me/patrick_sms_bot" class="btn">🤖 Open Bot</a>
      <a href="/ping" class="btn">📡 Ping</a>
      <a href="/stats" class="btn">📊 Stats</a>
    </div>

    <div class="footer">
      Powered by Render • Made with 💯<br>
      Source: sms24.me + receive-sms.cc
    </div>
  </div>
</body>
</html>
  `);
});

app.get('/ping', async (req, res) => {
  res.json({
    status: 'alive',
    uptime_seconds: Math.floor(process.uptime()),
    numbers: await countNumbers(),
    scraper: scrapingStatus,
    last_scrape: lastScrape,
    storage: supabaseStore.isEnabled() ? 'supabase' : 'local-file',
    self_pings: pingCount,
    last_self_ping: lastPingTime,
    timestamp: new Date().toISOString()
  });
});

app.get('/stats', async (req, res) => {
  try {
    const data = await supabaseStore.getAllNumbers();
    const status = await supabaseStore.status();
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
      last_scrape: lastScrape,
      storage: status.storage,
      stale: status.stale
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
    log('⚠️  Scraper already running');
    return;
  }
  scrapingStatus = 'running';
  log('🔄 ============ STARTING SCRAPER ============');
  try {
    const newNumbers = await scrapeAll();
    if (newNumbers && newNumbers.length > 0) {
      const result = await supabaseStore.saveNumbers(newNumbers);
      log(`💾 Saved ${result.saved} numbers to ${supabaseStore.isEnabled() ? 'Supabase' : 'local file'}`);
    }
    lastScrape = new Date().toISOString();
    totalNumbers = await countNumbers();
    log(`✅ Scraper done. Total: ${totalNumbers} numbers`);
  } catch (err) {
    log(`❌ Scraper error: ${err.message}`);
  } finally {
    scrapingStatus = 'idle';
    log('🔄 ============ SCRAPER IDLE ============');
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
    log(`❌ Bot crashed: ${err.message}, restarting in 5s...`);
    setTimeout(startBot, 5000);
  });

  botProcess.on('exit', (code) => {
    log(`⚠️  Bot exited (code ${code}), restarting in 5s...`);
    setTimeout(startBot, 5000);
  });
}

// =================== SELF-PINGER (keep Render awake) ===================

let pingCount = 0;
let lastPingTime = null;

function selfPing() {
  // Get our own URL from Render env var, or construct it
  const url = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
  if (!url) {
    log('⚠️  Self-ping: RENDER_EXTERNAL_URL not set, skipping (Render injects this automatically)');
    return;
  }

  pingCount++;
  lastPingTime = new Date().toISOString();

  const lib = url.startsWith('https') ? https : http;

  const start = Date.now();
  lib.get(url, { timeout: 10000 }, (res) => {
    const duration = Date.now() - start;
    log(`📡 Self-ping #${pingCount}: ${res.statusCode} (${duration}ms) - ${url}`);
    // Consume response data to free memory
    res.resume();
  }).on('error', (err) => {
    log(`⚠️  Self-ping failed: ${err.message}`);
  });
}

function startSelfPinger() {
  // Ping every 10 minutes (Render sleeps after 15 min of inactivity)
  const intervalMs = 10 * 60 * 1000; // 10 minutes

  log(`⏰ Starting self-pinger (every ${intervalMs / 60000} min) to prevent Render sleep`);

  // Wait 30 seconds after startup before first ping (let things settle)
  setTimeout(() => {
    selfPing();
    setInterval(selfPing, intervalMs);
  }, 30000);
}

// =================== MAIN ===================

async function main() {
  log('🚀 ============================================');
  log('🚀 APP STARTING (web + scraper + bot + self-ping)');
  log('🚀 ============================================');

  // Start the website FIRST so Render detects the port
  app.listen(PORT, '0.0.0.0', () => {
    log(`🌐 Website LIVE on port ${PORT}`);
  });

  // Start the bot
  startBot();

  // Start self-pinger to keep Render awake
  if (process.env.DISABLE_SELF_PING !== 'true') {
    startSelfPinger();
  }

  // Run scraper in background (don't block)
  if (process.env.RUN_SCRAPER_ON_START !== 'false') {
    log('🔄 Scheduling initial scraper in 5 seconds...');
    setTimeout(() => {
      runScraper().catch(err => log(`❌ Initial scrape failed: ${err.message}`));
    }, 5000);
  }

  // Re-scrape every 6 hours
  const hours = parseInt(process.env.SCRAPE_INTERVAL_HOURS || '6');
  setInterval(() => {
    log('⏰ Scheduled re-scrape triggered');
    runScraper().catch(err => log(`❌ Scheduled scrape failed: ${err.message}`));
  }, hours * 60 * 60 * 1000);
  log(`⏰ Auto re-scrape every ${hours} hours`);

  log('✅ APP READY');
}

main().catch(err => {
  log(`❌ FATAL: ${err.message}`);
  process.exit(1);
});
