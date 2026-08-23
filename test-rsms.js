const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  // Test a receive-sms.cc inbox
  const url = 'https://receive-sms.cc/US-Phone-Number/16506671441';
  console.log(`Testing: ${url}`);
  
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 30000
    });
    
    const $ = cheerio.load(data);
    const messages = [];
    $('div.item').each((i, el) => {
      const from = $(el).find('.form').text().trim();
      const time = $(el).find('.time').text().trim();
      const content = $(el).find('.con').text().trim();
      if (content) messages.push({ from, time, content });
    });
    
    console.log(`✅ Got ${messages.length} messages from receive-sms.cc:`);
    messages.slice(0, 3).forEach((m, i) => {
      console.log(`  ${i+1}. [${m.from}] ${m.content.substring(0, 100)}`);
    });
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

test();
