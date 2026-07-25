import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS bank_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT UNIQUE NOT NULL,
    fecha TEXT NOT NULL,
    referencia TEXT,
    transaccion TEXT,
    descripcion TEXT,
    debito REAL,
    credito REAL,
    saldo REAL,
    direction TEXT NOT NULL CHECK (direction IN ('debito','credito')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ignored','processed')),
    contact_type TEXT CHECK (contact_type IN ('proveedor','cliente')),
    alegra_contact_id TEXT,
    alegra_contact_name TEXT,
    alegra_payment_id TEXT,
    processed_amount REAL,
    source_file TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_bank_movements_status ON bank_movements(status);
  CREATE INDEX IF NOT EXISTS idx_bank_movements_direction ON bank_movements(direction);

  CREATE TABLE IF NOT EXISTS alegra_payments (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('in','out')),
    amount REAL NOT NULL,
    contact_id TEXT,
    contact_name TEXT,
    number TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_alegra_payments_type_date ON alegra_payments(type, date);

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export interface BankMovementRow {
  id: number;
  hash: string;
  fecha: string;
  referencia: string | null;
  transaccion: string | null;
  descripcion: string | null;
  debito: number | null;
  credito: number | null;
  saldo: number | null;
  direction: "debito" | "credito";
  status: "pending" | "ignored" | "processed";
  contact_type: "proveedor" | "cliente" | null;
  alegra_contact_id: string | null;
  alegra_contact_name: string | null;
  alegra_payment_id: string | null;
  processed_amount: number | null;
  source_file: string | null;
  imported_at: string;
  processed_at: string | null;
}
