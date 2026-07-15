const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'debt-app.db');
}

function initDatabase() {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name),
      UNIQUE(phone)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('SAR','YER','USD')),
      direction TEXT NOT NULL CHECK(direction IN ('له','عليه')),
      converted_amount REAL NOT NULL,
      rate_at_time REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migration: fix CHECK constraint if old schema (دين عليك/دين لك)
  // Inspect the table definition directly instead of a test INSERT:
  // a test row with client_id=0 always violates the foreign key, which made
  // the old detection rebuild the table on every startup.
  const schemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'").get();
  const hasOldCheck = schemaRow && schemaRow.sql && schemaRow.sql.includes('دين عليك');
  if (hasOldCheck) {
    db.exec(`
      DROP TABLE IF EXISTS transactions_old;
      ALTER TABLE transactions RENAME TO transactions_old;
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL CHECK(currency IN ('SAR','YER','USD')),
        direction TEXT NOT NULL CHECK(direction IN ('له','عليه')),
        converted_amount REAL NOT NULL,
        rate_at_time REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      );
      INSERT INTO transactions (id, client_id, item_name, amount, currency, direction, converted_amount, rate_at_time, created_at)
        SELECT id, client_id, item_name, amount, currency,
          CASE WHEN direction = 'دين عليك' THEN 'له' WHEN direction = 'دين لك' THEN 'عليه' ELSE direction END,
          converted_amount, rate_at_time, created_at
        FROM transactions_old;
      DROP TABLE transactions_old;
    `);
  }

  // Insert default settings if not exist
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('usd_to_yer', '2500');
  insertSetting.run('sar_to_yer', '666');
  insertSetting.run('theme', 'dark');
  insertSetting.run('backup_path', '');
  insertSetting.run('auto_backup', 'false');

  return db;
}

function getDb() {
  return db;
}

module.exports = { initDatabase, getDb, getDbPath };
