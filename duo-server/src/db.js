import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");
export const UPLOAD_DIR = join(ROOT, "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(join(ROOT, "duo.db"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL,
    pub_key TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS couples (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS couple_members (
    couple_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    slot INTEGER NOT NULL,
    PRIMARY KEY (couple_id, user_id),
    FOREIGN KEY (couple_id) REFERENCES couples(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    couple_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    text TEXT,
    url TEXT,
    created_at INTEGER NOT NULL,
    nonce TEXT,
    FOREIGN KEY (couple_id) REFERENCES couples(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_couple
    ON messages(couple_id, created_at);
`);

export default db;
