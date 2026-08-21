// sudo-store.js
// Sudo user management with Supabase (for Render) or disk (for panel)
// Usage:
//   const sudoStore = require('./sudo-store');
//   await sudoStore.add(userId);     // returns { ok, count, added }
//   await sudoStore.remove(userId);
//   await sudoStore.has(userId);
//   await sudoStore.list();
//   await sudoStore.clear();         // owner only

const fs = require('fs');
const path = require('path');

const SUDO_FILE = 'sudo.json';

// In-memory cache
let sudoList = new Set();
let loaded = false;

function log(msg) {
  console.log(`[${new Date().toISOString()}] [sudo] ${msg}`);
}

// =================== SUPABASE ===================

async function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;

  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key);
  } catch (e) {
    log(`⚠️  Supabase not available: ${e.message}`);
    return null;
  }
}

// =================== STORAGE OPS ===================

async function load() {
  const sb = await getSupabaseClient();

  if (sb) {
    try {
      const { data, error } = await sb.from('sudo_users').select('user_id');
      if (error) throw error;
      sudoList = new Set((data || []).map(r => String(r.user_id)));
      log(`Loaded ${sudoList.size} sudo users from Supabase`);
    } catch (e) {
      log(`❌ Supabase load failed: ${e.message}, falling back to disk`);
      loadFromDisk();
    }
  } else {
    loadFromDisk();
  }
  loaded = true;
}

function loadFromDisk() {
  try {
    if (fs.existsSync(SUDO_FILE)) {
      const data = JSON.parse(fs.readFileSync(SUDO_FILE, 'utf-8'));
      sudoList = new Set((data.users || []).map(String));
      log(`Loaded ${sudoList.size} sudo users from disk`);
    } else {
      sudoList = new Set();
      saveToDisk();
    }
  } catch (e) {
    log(`❌ Disk load failed: ${e.message}`);
    sudoList = new Set();
  }
}

function saveToDisk() {
  try {
    fs.writeFileSync(SUDO_FILE, JSON.stringify({ users: Array.from(sudoList) }, null, 2));
  } catch (e) {
    log(`❌ Disk save failed: ${e.message}`);
  }
}

async function save() {
  const sb = await getSupabaseClient();
  if (sb) {
    try {
      // Upsert all current sudo users
      const rows = Array.from(sudoList).map(uid => ({ user_id: String(uid) }));
      // Delete all then re-insert (simple sync strategy)
      await sb.from('sudo_users').delete().gte('created_at', '1970-01-01');
      if (rows.length > 0) {
        const { error } = await sb.from('sudo_users').insert(rows);
        if (error) throw error;
      }
      log(`Saved ${rows.length} sudo users to Supabase`);
    } catch (e) {
      log(`❌ Supabase save failed: ${e.message}, falling back to disk`);
      saveToDisk();
    }
  } else {
    saveToDisk();
  }
}

// =================== PUBLIC API ===================

async function ensureLoaded() {
  if (!loaded) await load();
}

async function add(userId) {
  await ensureLoaded();
  const id = String(userId);
  const wasNew = !sudoList.has(id);
  sudoList.add(id);
  await save();
  log(`+${id} (now ${sudoList.size} total)`);
  return { ok: true, added: wasNew, count: sudoList.size };
}

async function remove(userId) {
  await ensureLoaded();
  const id = String(userId);
  const existed = sudoList.has(id);
  sudoList.delete(id);
  await save();
  log(`-${id} (now ${sudoList.size} total)`);
  return { ok: true, removed: existed, count: sudoList.size };
}

async function has(userId) {
  await ensureLoaded();
  return sudoList.has(String(userId));
}

async function list() {
  await ensureLoaded();
  return Array.from(sudoList);
}

async function count() {
  await ensureLoaded();
  return sudoList.size;
}

async function clear() {
  await ensureLoaded();
  const n = sudoList.size;
  sudoList = new Set();
  await save();
  log(`CLEARED (was ${n})`);
  return { ok: true, cleared: n };
}

// =================== INIT ===================

// Auto-load on require
load().catch(e => log(`Init load error: ${e.message}`));

module.exports = {
  add,
  remove,
  has,
  list,
  count,
  clear,
  load
};
