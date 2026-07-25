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

function logAndFail(res: import("express").Response, label: string, err: any, message: string) {
  // eslint-disable-next-line no-console
  console.error(`[${label}]`, err.response?.data ?? err.message);
  res.status(502).json({ error: message, detail: err.response?.data ?? err.message });
}

alegraRouter.get("/contacts", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  try {
    const contacts = await alegraClient.searchContacts(q);
    res.json(contacts);
  } catch (err: any) {
    logAndFail(res, "GET /api/alegra/contacts", err, "No se pudo consultar contactos en Alegra");
  }
});

alegraRouter.get("/bank-accounts", async (_req, res) => {
  try {
    res.json(await alegraClient.getBankAccounts());
  } catch (err: any) {
    logAndFail(res, "GET /api/alegra/bank-accounts", err, "No se pudo consultar cuentas bancarias en Alegra");
  }
});

alegraRouter.get("/cost-centers", async (_req, res) => {
  try {
    res.json(await alegraClient.getCostCenters());
  } catch (err: any) {
    logAndFail(res, "GET /api/alegra/cost-centers", err, "No se pudo consultar centros de costo en Alegra");
  }
});

alegraRouter.get("/bills-payable", async (_req, res) => {
  try {
    const bills = await alegraClient.getAllOpenBills();
    const movements = pendingMovements("debito");
    const withMatch = bills.map((b) => ({ ...b, hasBankMatch: findStrongBankMatch(b, movements) }));
    res.json(withMatch);
  } catch (err: any) {
    logAndFail(res, "GET /api/alegra/bills-payable", err, "No se pudieron consultar las cuentas por pagar");
  }
});

alegraRouter.get("/invoices-receivable", async (_req, res) => {
  try {
    const invoices = await alegraClient.getAllOpenInvoices();
    const movements = pendingMovements("credito");
    const withMatch = invoices.map((i) => ({ ...i, hasBankMatch: findStrongBankMatch(i, movements) }));
    res.json(withMatch);
  } catch (err: any) {
    logAndFail(res, "GET /api/alegra/invoices-receivable", err, "No se pudieron consultar las cuentas por cobrar");
  }
});

alegraRouter.get("/contacts/:id/bills", async (req, res) => {
  try {
    res.json(await alegraClient.getPendingBills(req.params.id));
  } catch (err: any) {
    logAndFail(res, "GET /api/alegra/contacts/:id/bills", err, "No se pudieron consultar las facturas de compra pendientes");
  }
});

alegraRouter.get("/contacts/:id/invoices", async (req, res) => {
  try {
    res.json(await alegraClient.getPendingInvoices(req.params.id));
  } catch (err: any) {
    logAndFail(res, "GET /api/alegra/contacts/:id/invoices", err, "No se pudieron consultar las facturas de venta pendientes");
  }
});
