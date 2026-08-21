// cron.js
// Optional: Run this alongside the bot to re-scrape every X hours
// Render free workers can run this, or use external cron services

const { scrapeAll } = require('./scraper-sms24');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const HOURS = parseInt(process.env.SCRAPE_INTERVAL_HOURS || '6');
const INTERVAL_MS = HOURS * 60 * 60 * 1000;

log(`⏰ Cron started: will scrape every ${HOURS} hours`);

// Run immediately
log('🔄 Running initial scrape...');
scrapeAll()
  .then(() => log('✅ Initial scrape done'))
  .catch(err => log(`❌ Initial scrape failed: ${err.message}`));

// Then every X hours
setInterval(() => {
  log('🔄 Running scheduled scrape...');
  scrapeAll()
    .then(() => log('✅ Scheduled scrape done'))
    .catch(err => log(`❌ Scheduled scrape failed: ${err.message}`));
}, INTERVAL_MS);
