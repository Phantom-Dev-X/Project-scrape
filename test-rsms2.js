const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  const url = 'https://receive-sms.cc/US-Phone-Number/16506671441';
  console.log(`Testing: ${url}`);
  
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      },
      timeout: 30000
    });
    
    console.log(`Got response, length: ${data.length}`);
    
    const $ = cheerio.load(data);
    const messages = [];
    $('div.item').each((i, el) => {
      const from = $(el).find('.form').text().trim();
      const time = $(el).find('.time').text().trim();
      const content = $(el).find('.con').text().trim();
      if (content) messages.push({ from, time, content });
    });
    
    console.log(`✅ Got ${messages.length} messages:`);
    messages.slice(0, 3).forEach((m, i) => {
      console.log(`  ${i+1}. [${m.from}] ${m.content.substring(0, 100)}`);
    });
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

test();
