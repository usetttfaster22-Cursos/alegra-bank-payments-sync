import { Router } from "express";
import { alegraClient } from "../alegraClient";
import { db, BankMovementRow } from "../db";
import { findStrongBankMatch } from "../matching";

export const alegraRouter = Router();

function pendingMovements(direction: "debito" | "credito") {
  const rows = db
    .prepare("SELECT * FROM bank_movements WHERE status = 'pending' AND direction = ?")
    .all(direction) as BankMovementRow[];
  return rows.map((r) => ({
    descripcion: r.descripcion,
    fecha: r.fecha,
    amount: (direction === "debito" ? r.debito : r.credito) ?? 0,
  }));
}

alegraRouter.get("/contacts", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  try {
    const contacts = await alegraClient.searchContacts(q);
    res.json(contacts);
  } catch (err: any) {
    res.status(502).json({ error: "No se pudo consultar contactos en Alegra", detail: err.response?.data ?? err.message });
  }
});

alegraRouter.get("/bank-accounts", async (_req, res) => {
  try {
    res.json(await alegraClient.getBankAccounts());
  } catch (err: any) {
    res.status(502).json({ error: "No se pudo consultar cuentas bancarias en Alegra", detail: err.response?.data ?? err.message });
  }
});

alegraRouter.get("/cost-centers", async (_req, res) => {
  try {
    res.json(await alegraClient.getCostCenters());
  } catch (err: any) {
    res.status(502).json({ error: "No se pudo consultar centros de costo en Alegra", detail: err.response?.data ?? err.message });
  }
});

alegraRouter.get("/bills-payable", async (_req, res) => {
  try {
    const bills = await alegraClient.getAllOpenBills();
    const movements = pendingMovements("debito");
    const withMatch = bills.map((b) => ({ ...b, hasBankMatch: findStrongBankMatch(b, movements) }));
    res.json(withMatch);
  } catch (err: any) {
    res.status(502).json({ error: "No se pudieron consultar las cuentas por pagar", detail: err.response?.data ?? err.message });
  }
});

alegraRouter.get("/invoices-receivable", async (_req, res) => {
  try {
    const invoices = await alegraClient.getAllOpenInvoices();
    const movements = pendingMovements("credito");
    const withMatch = invoices.map((i) => ({ ...i, hasBankMatch: findStrongBankMatch(i, movements) }));
    res.json(withMatch);
  } catch (err: any) {
    res.status(502).json({ error: "No se pudieron consultar las cuentas por cobrar", detail: err.response?.data ?? err.message });
  }
});

alegraRouter.get("/contacts/:id/bills", async (req, res) => {
  try {
    res.json(await alegraClient.getPendingBills(req.params.id));
  } catch (err: any) {
    res.status(502).json({ error: "No se pudieron consultar las facturas de compra pendientes", detail: err.response?.data ?? err.message });
  }
});

alegraRouter.get("/contacts/:id/invoices", async (req, res) => {
  try {
    res.json(await alegraClient.getPendingInvoices(req.params.id));
  } catch (err: any) {
    res.status(502).json({ error: "No se pudieron consultar las facturas de venta pendientes", detail: err.response?.data ?? err.message });
  }
});
