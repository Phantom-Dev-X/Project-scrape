// cleanup-supabase.js
// One-time script to clean old sms24.me data from Supabase
// Run this if you have old data in Supabase

const supabaseStore = require('./supabase-store');

async function main() {
  console.log('🧹 Cleaning old sms24.me data from Supabase...');
  
  // Get all numbers
  const all = await supabaseStore.getAllNumbers();
  console.log(`📊 Found ${all.length} total numbers in Supabase`);
  
  // Count by source
  const bySource = {};
  all.forEach(n => {
    bySource[n.source] = (bySource[n.source] || 0) + 1;
  });
  console.log('📊 By source:', bySource);
  
  // We need to delete sms24.me numbers one by one (no source filter in our store)
  const sms24 = all.filter(n => n.source === 'sms24.me');
  console.log(`🗑️  Deleting ${sms24.length} sms24.me numbers...`);
  
  for (const num of sms24) {
    await supabaseStore.removeNumber(num.phone);
  }
  
  console.log('✅ Cleanup done');
  
  // Verify
  const after = await supabaseStore.getAllNumbers();
  console.log(`📊 Remaining: ${after.length} numbers`);
}

main().catch(console.error);
