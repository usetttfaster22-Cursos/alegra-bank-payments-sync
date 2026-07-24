import { Router } from "express";
import { alegraClient } from "../alegraClient";

export const alegraRouter = Router();

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
