// Selects the storage backend by env. DB_DRIVER=mysql (Hostinger) | json (local dev, default).
import { jsonDb } from './store/json.js';

export async function initStore() {
  const driver = (process.env.DB_DRIVER || 'json').toLowerCase();
  let db;
  if (driver === 'mysql') {
    const { makeMysqlDb } = await import('./store/mysql.js');
    db = await makeMysqlDb();
  } else {
    db = jsonDb;
  }
  await db.init();
  console.log(`[store] using ${db.driver} backend`);
  return db;
}
