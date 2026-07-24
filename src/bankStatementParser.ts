import * as XLSX from "xlsx";
import crypto from "node:crypto";

export interface ParsedMovement {
  hash: string;
  fecha: string; // ISO yyyy-mm-dd
  referencia: string | null;
  transaccion: string | null;
  descripcion: string | null;
  debito: number | null;
  credito: number | null;
  saldo: number | null;
  direction: "debito" | "credito";
}

const EXPECTED_HEADERS = ["fecha", "referencia", "transaccion", "descripcion", "debito", "credito"];

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${mm}-${dd}`;
    }
  }
  return String(value ?? "").trim();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parsea el extracto de movimientos de cuenta corriente (formato exportado por
 * Banco General - "BGPCheckingMovementsExcel"). El archivo trae varias filas de
 * metadata (número de cuenta, empresa, rango de fechas) antes de la fila de
 * encabezados reales, así que se busca esa fila en vez de asumir una posición fija.
 */
export function parseBankStatement(buffer: Buffer): ParsedMovement[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map(normalize);
    return EXPECTED_HEADERS.every((expected) => normalized.some((cell) => cell.startsWith(expected)));
  });

  if (headerIndex === -1) {
    throw new Error(
      "No se encontró la fila de encabezados esperada (Fecha, Referencia, Transacción, Descripción, Débito, Crédito). ¿Es este el formato de extracto de Banco General?"
    );
  }

  const headers = rows[headerIndex].map(normalize);
  const col = (name: string) => headers.findIndex((h) => h.startsWith(name));

  const idx = {
    fecha: col("fecha"),
    referencia: col("referencia"),
    transaccion: col("transaccion"),
    descripcion: col("descripcion"),
    debito: col("debito"),
    credito: col("credito"),
    saldo: col("saldo"),
  };

  const movements: ParsedMovement[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    if (!row || row.every((cell) => cell === null || cell === "")) continue;

    const fechaRaw = row[idx.fecha];
    if (!fechaRaw) continue;

    const fecha = toIsoDate(fechaRaw);
    const referencia = idx.referencia >= 0 ? String(row[idx.referencia] ?? "").trim() || null : null;
    const transaccion = idx.transaccion >= 0 ? String(row[idx.transaccion] ?? "").trim() || null : null;
    const descripcion = idx.descripcion >= 0 ? String(row[idx.descripcion] ?? "").trim() || null : null;
    const debito = idx.debito >= 0 ? toNumber(row[idx.debito]) : null;
    const credito = idx.credito >= 0 ? toNumber(row[idx.credito]) : null;
    const saldo = idx.saldo >= 0 ? toNumber(row[idx.saldo]) : null;

    if (debito === null && credito === null) continue;

    const direction: "debito" | "credito" = debito !== null && debito > 0 ? "debito" : "credito";

    const hash = crypto
      .createHash("sha256")
      .update(`${fecha}|${referencia}|${transaccion}|${descripcion}|${debito}|${credito}|${saldo}`)
      .digest("hex");

    movements.push({ hash, fecha, referencia, transaccion, descripcion, debito, credito, saldo, direction });
  }

  return movements;
}
