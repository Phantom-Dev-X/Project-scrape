// supabase-store.js
// Supabase integration for persistent number storage
// Replaces/supplements local data-sms24.json
//
// SETUP:
// 1. Create a Supabase project at https://supabase.com
// 2. Run this SQL in the SQL editor:
//    CREATE TABLE numbers (
//      id BIGSERIAL PRIMARY KEY,
//      phone TEXT UNIQUE NOT NULL,
//      country TEXT NOT NULL,
//      last_sms TEXT,
//      sms_count TEXT,
//      link TEXT,
//      source TEXT,
//      created_at TIMESTAMPTZ DEFAULT NOW(),
//      updated_at TIMESTAMPTZ DEFAULT NOW(),
//      last_checked TIMESTAMPTZ
//    );
// 3. Set environment variables:
//    SUPABASE_URL=https://xxxxx.supabase.co
//    SUPABASE_KEY=your_anon_or_service_key
//
// If Supabase is not configured, falls back to local file storage.

const fs = require('fs');

const LOCAL_FILE = 'data-sms24.json';
const STALE_HOURS = 6; // Re-scrape if data is older than this

let client = null;
let enabled = false;

function log(msg) {
  console.log(`[${new Date().toISOString()}] [supabase] ${msg}`);
}

function init() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    log('⚠️  SUPABASE_URL / SUPABASE_KEY not set. Using local file storage.');
    return false;
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(url, key);
    enabled = true;
    log('✅ Supabase connected');
    return true;
  } catch (e) {
    log(`❌ Supabase init failed: ${e.message}`);
    return false;
  }
}

// =================== READ ===================

async function getAllNumbers() {
  if (enabled) {
    try {
      const { data, error } = await client
        .from('numbers')
        .select('*')
        .order('country', { ascending: true });

      if (error) throw error;

      // Normalize to our standard format
      return (data || []).map(row => ({
        phone: row.phone,
        country: row.country,
        smsCount: row.sms_count || 'Live inbox',
        lastSms: row.last_sms || 'Recent',
        link: row.link,
        source: row.source || 'sms24.me',
        updatedAt: row.updated_at
      }));
    } catch (e) {
      log(`❌ Supabase read failed: ${e.message}, falling back to file`);
    }
  }

  // Fallback: local file
  try {
    if (fs.existsSync(LOCAL_FILE)) {
      return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

async function getCount() {
  if (enabled) {
    try {
      const { count, error } = await client
        .from('numbers')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    } catch (e) {}
  }

  try {
    if (fs.existsSync(LOCAL_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf-8'));
      return data.length;
    }
  } catch (e) {}
  return 0;
}

async function isStale() {
  if (enabled) {
    try {
      const { data, error } = await client
        .from('numbers')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return true;

      const lastUpdate = new Date(data[0].updated_at);
      const ageHours = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
      return ageHours > STALE_HOURS;
    } catch (e) {
      log(`❌ Stale check failed: ${e.message}`);
    }
  }

  // Fallback: check file mtime
  try {
    if (fs.existsSync(LOCAL_FILE)) {
      const stat = fs.statSync(LOCAL_FILE);
      const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
      return ageHours > STALE_HOURS;
    }
  } catch (e) {}
  return true; // No data = stale
}

async function getLastUpdate() {
  if (enabled) {
    try {
      const { data, error } = await client
        .from('numbers')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      if (data && data.length > 0) return new Date(data[0].updated_at);
    } catch (e) {}
  }

  try {
    if (fs.existsSync(LOCAL_FILE)) {
      const stat = fs.statSync(LOCAL_FILE);
      return stat.mtime;
    }
  } catch (e) {}
  return null;
}

// =================== WRITE ===================

async function saveNumbers(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    log('⚠️  saveNumbers: empty array, nothing to save');
    return { saved: 0 };
  }

  // Always save to local file as backup
  try {
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(numbers, null, 2));
    log(`💾 Saved ${numbers.length} numbers to local file`);
  } catch (e) {
    log(`❌ Local file save failed: ${e.message}`);
  }

  if (enabled) {
    try {
      // Prepare rows for Supabase (upsert)
      const rows = numbers.map(n => ({
        phone: n.phone,
        country: n.country,
        sms_count: n.smsCount || null,
        last_sms: n.lastSms || null,
        link: n.link || null,
        source: n.source || 'sms24.me',
        updated_at: new Date().toISOString()
      }));

      // Upsert: insert or update if phone exists
      const { data, error } = await client
        .from('numbers')
        .upsert(rows, { onConflict: 'phone' })
        .select();

      if (error) throw error;

      log(`✅ Saved ${data?.length || rows.length} numbers to Supabase`);
      return { saved: data?.length || rows.length };
    } catch (e) {
      log(`❌ Supabase save failed: ${e.message}`);
      return { saved: 0, error: e.message };
    }
  }

  return { saved: numbers.length, source: 'local' };
}

async function clearAll() {
  if (enabled) {
    try {
      const { error } = await client
        .from('numbers')
        .delete()
        .gte('id', 0);
      if (error) throw error;
      log('🗑️  Cleared all numbers from Supabase');
    } catch (e) {
      log(`❌ Supabase clear failed: ${e.message}`);
    }
  }

  try {
    if (fs.existsSync(LOCAL_FILE)) {
      fs.unlinkSync(LOCAL_FILE);
      log('🗑️  Deleted local data file');
    }
  } catch (e) {}
}

async function removeNumber(phone) {
  if (enabled) {
    try {
      const { error } = await client
        .from('numbers')
        .delete()
        .eq('phone', phone);
      if (error) throw error;
    } catch (e) {
      log(`❌ Supabase delete failed: ${e.message}`);
    }
  }
}

async function status() {
  return {
    enabled,
    count: await getCount(),
    stale: await isStale(),
    lastUpdate: await getLastUpdate(),
    staleThresholdHours: STALE_HOURS,
    storage: enabled ? 'supabase' : 'local-file'
  };
}

// Initialize on require
init();

module.exports = {
  init,
  getAllNumbers,
  getCount,
  isStale,
  getLastUpdate,
  saveNumbers,
  clearAll,
  removeNumber,
  status,
  isEnabled: () => enabled
};
