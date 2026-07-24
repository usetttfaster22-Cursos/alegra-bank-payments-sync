import { Router } from "express";
import multer from "multer";
import { db, BankMovementRow } from "../db";
import { parseBankStatement } from "../bankStatementParser";
import { alegraClient } from "../alegraClient";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const movementsRouter = Router();

movementsRouter.post("/import", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Falta el archivo (campo 'file')." });
  }

  let parsed;
  try {
    parsed = parseBankStatement(req.file.buffer);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bank_movements
      (hash, fecha, referencia, transaccion, descripcion, debito, credito, saldo, direction, source_file)
    VALUES (@hash, @fecha, @referencia, @transaccion, @descripcion, @debito, @credito, @saldo, @direction, @source_file)
  `);

  let inserted = 0;
  const tx = db.transaction((rows: typeof parsed) => {
    for (const row of rows) {
      const info = insert.run({ ...row, source_file: req.file!.originalname });
      if (info.changes > 0) inserted += 1;
    }
  });
  tx(parsed);

  res.json({ total: parsed.length, inserted, duplicates: parsed.length - inserted });
});

movementsRouter.get("/", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const direction = typeof req.query.direction === "string" ? req.query.direction : undefined;

  let query = "SELECT * FROM bank_movements WHERE 1=1";
  const params: Record<string, string> = {};
  if (status) {
    query += " AND status = @status";
    params.status = status;
  }
  if (direction) {
    query += " AND direction = @direction";
    params.direction = direction;
  }
  query += " ORDER BY fecha DESC, id DESC";

  const rows = db.prepare(query).all(params) as BankMovementRow[];
  res.json(rows);
});

movementsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(req.params.id) as BankMovementRow | undefined;
  if (!row) return res.status(404).json({ error: "Movimiento no encontrado" });
  res.json(row);
});

movementsRouter.post("/:id/ignore", (req, res) => {
  const info = db
    .prepare("UPDATE bank_movements SET status = 'ignored', processed_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(req.params.id);
  if (info.changes === 0) return res.status(409).json({ error: "El movimiento no está pendiente o no existe." });
  res.json({ ok: true });
});

interface MatchBody {
  contactId: string;
  contactName: string;
  contactType: "proveedor" | "cliente";
  bankAccountId: string;
  paymentMethod: string;
  currencyCode: string;
  costCenterId?: string;
  observations?: string;
  applications: { id: string; amount: number }[];
}

movementsRouter.post("/:id/match", async (req, res) => {
  const row = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(req.params.id) as BankMovementRow | undefined;
  if (!row) return res.status(404).json({ error: "Movimiento no encontrado" });
  if (row.status !== "pending") return res.status(409).json({ error: "El movimiento no está pendiente." });

  const body = req.body as MatchBody;
  if (!body.contactId || !body.contactType || !body.applications?.length) {
    return res.status(400).json({ error: "Faltan datos: contactId, contactType y applications son requeridos." });
  }

  const expectedAmount = row.direction === "debito" ? row.debito : row.credito;
  const appliedTotal = body.applications.reduce((sum, a) => sum + a.amount, 0);
  if (expectedAmount !== null && Math.abs(appliedTotal - expectedAmount) > 0.01) {
    return res.status(400).json({
      error: `El monto aplicado (${appliedTotal}) no coincide con el monto del movimiento (${expectedAmount}).`,
    });
  }

  try {
    const direction = row.direction === "debito" ? "out" : "in";
    const result = await alegraClient.createPayment({
      direction,
      date: row.fecha,
      bankAccountId: body.bankAccountId,
      paymentMethod: body.paymentMethod,
      currencyCode: body.currencyCode,
      costCenterId: body.costCenterId,
      observations: body.observations ?? row.descripcion ?? undefined,
      applications: body.applications,
    });

    db.prepare(`
      UPDATE bank_movements SET
        status = 'processed',
        contact_type = @contactType,
        alegra_contact_id = @contactId,
        alegra_contact_name = @contactName,
        alegra_payment_id = @paymentId,
        processed_amount = @amount,
        processed_at = datetime('now')
      WHERE id = @id
    `).run({
      id: row.id,
      contactType: body.contactType,
      contactId: body.contactId,
      contactName: body.contactName,
      paymentId: result.id,
      amount: appliedTotal,
    });

    res.json({ ok: true, dryRun: result.dryRun, alegraPaymentId: result.id, payload: result.payload });
  } catch (err: any) {
    const detail = err.response?.data ?? err.message;
    res.status(502).json({ error: "Error al crear el pago en Alegra", detail });
  }
});
