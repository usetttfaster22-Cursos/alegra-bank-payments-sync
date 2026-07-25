import { Router } from "express";
import { db, BankMovementRow } from "../db";
import { alegraClient, AlegraOpenDocument } from "../alegraClient";
import { syncRecentPayments, getCachedPayments } from "../paymentsSync";
import { classifyMovement } from "../matching";

export const dashboardRouter = Router();

const PAYMENTS_LOOKBACK_SINCE = process.env.PAYMENTS_LOOKBACK_SINCE || "2026-01-01";

function topByContact(docs: AlegraOpenDocument[], n = 5) {
  const totals = new Map<string, number>();
  for (const d of docs) totals.set(d.contactName, (totals.get(d.contactName) ?? 0) + d.balance);
  return [...totals.entries()]
    .map(([contactName, total]) => ({ contactName, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

function overdueSummary(docs: AlegraOpenDocument[]) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = docs.filter((d) => d.dueDate && d.dueDate < today);
  return { count: overdue.length, total: overdue.reduce((s, d) => s + d.balance, 0) };
}

interface MissingRow {
  id: number;
  fecha: string;
  descripcion: string | null;
  monto: number;
}

function classifyPending(
  rows: BankMovementRow[],
  direction: "debito" | "credito",
  openDocs: AlegraOpenDocument[],
  registered: AlegraOpenDocument[]
) {
  let matched = 0;
  let duplicate = 0;
  const missing: MissingRow[] = [];

  for (const r of rows) {
    const amount = direction === "debito" ? r.debito : r.credito;
    if (amount === null) continue;
    const movement = { descripcion: r.descripcion, fecha: r.fecha, amount };
    const outcome = classifyMovement(movement, openDocs, registered);
    if (outcome === "duplicate") duplicate++;
    else if (outcome === "matched") matched++;
    else missing.push({ id: r.id, fecha: r.fecha, descripcion: r.descripcion, monto: amount });
  }

  return { matched, duplicate, missing };
}

dashboardRouter.get("/", async (_req, res) => {
  try {
    const [bills, invoices] = await Promise.all([alegraClient.getAllOpenBills(), alegraClient.getAllOpenInvoices()]);

    await syncRecentPayments(PAYMENTS_LOOKBACK_SINCE);
    const registeredOut = getCachedPayments(PAYMENTS_LOOKBACK_SINCE, "out");
    const registeredIn = getCachedPayments(PAYMENTS_LOOKBACK_SINCE, "in");

    const pendingDebito = db
      .prepare("SELECT * FROM bank_movements WHERE status = 'pending' AND direction = 'debito'")
      .all() as BankMovementRow[];
    const pendingCredito = db
      .prepare("SELECT * FROM bank_movements WHERE status = 'pending' AND direction = 'credito'")
      .all() as BankMovementRow[];

    const debitoStats = classifyPending(pendingDebito, "debito", bills, registeredOut);
    const creditoStats = classifyPending(pendingCredito, "credito", invoices, registeredIn);

    res.json({
      accountsPayable: {
        total: bills.reduce((s, b) => s + b.balance, 0),
        count: bills.length,
        overdue: overdueSummary(bills),
        top: topByContact(bills),
      },
      accountsReceivable: {
        total: invoices.reduce((s, i) => s + i.balance, 0),
        count: invoices.length,
        overdue: overdueSummary(invoices),
        top: topByContact(invoices),
      },
      movements: {
        pendingProviders: pendingDebito.length,
        pendingClients: pendingCredito.length,
        suggestedProviders: debitoStats.matched,
        suggestedClients: creditoStats.matched,
        duplicatesProviders: debitoStats.duplicate,
        duplicatesClients: creditoStats.duplicate,
      },
      missingProviderInvoices: debitoStats.missing,
      missingClientInvoices: creditoStats.missing,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/dashboard]", err.response?.data ?? err.message);
    res.status(502).json({ error: "No se pudo calcular el dashboard", detail: err.response?.data ?? err.message });
  }
});
