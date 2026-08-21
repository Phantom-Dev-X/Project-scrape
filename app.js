// app.js
// Main entry point: runs scraper first, then starts the bot
// This is the file Render will run

const { scrapeAll } = require('./scraper-sms24');
const { spawn } = require('child_process');
const fs = require('fs');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function runScraper() {
  log('🔄 Running scraper on startup...');
  try {
    await scrapeAll();
    log('✅ Scraper done');
  } catch (err) {
    log(`❌ Scraper failed: ${err.message}`);
    log('Continuing anyway with existing data.json if available...');
  }
}

function startBot() {
  log('🤖 Starting bot...');
  const bot = spawn('node', ['bot.js'], {
    stdio: 'inherit',
    env: process.env
  });

  bot.on('error', (err) => {
    log(`❌ Bot crashed: ${err.message}`);
    log('Restarting in 5 seconds...');
    setTimeout(startBot, 5000);
  });

  bot.on('exit', (code) => {
    log(`⚠️  Bot exited with code ${code}`);
    log('Restarting in 5 seconds...');
    setTimeout(startBot, 5000);
  });

  return bot;
}

async function main() {
  log('🚀 APP STARTING');

  // Step 1: Run scraper to get fresh data
  if (process.env.RUN_SCRAPER_ON_START !== 'false') {
    await runScraper();
  } else {
    log('⏭️  Skipping scraper (RUN_SCRAPER_ON_START=false)');
  }

  // Step 2: Start the bot
  startBot();
}

main().catch(err => {
  log(`❌ FATAL: ${err.message}`);
  process.exit(1);
});
