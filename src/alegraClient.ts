import axios, { AxiosInstance } from "axios";

/**
 * Cliente de la API de Alegra (https://developer.alegra.com/).
 *
 * IMPORTANTE: los nombres de campo de "createPayment" están armados según la
 * estructura documentada de la API v1 de Alegra (endpoint /payments), pero no
 * pudieron verificarse contra la documentación en vivo ni contra una cuenta
 * real al momento de escribir este cliente. Antes de usarlo en producción:
 *   1. Deja DRY_RUN=true (default) y revisa en los logs el payload que se
 *      generaría para un pago real.
 *   2. Compara ese payload contra https://developer.alegra.com/reference/post_payments
 *      con tu propia cuenta, o pruébalo primero con un movimiento de bajo monto.
 *   3. Ajusta el body en createPayment() si algún nombre de campo no coincide.
 */

export interface AlegraContact {
  id: string;
  name: string;
  identification?: string;
}

export interface AlegraPendingDocument {
  id: string;
  numberTemplate?: string;
  date?: string;
  dueDate?: string;
  total: number;
  balance: number;
}

export interface AlegraBankAccount {
  id: string;
  name: string;
}

export interface AlegraCostCenter {
  id: string;
  name: string;
}

export type PaymentDirection = "in" | "out";

export interface CreatePaymentInput {
  direction: PaymentDirection; // "in" = cobro de cliente, "out" = pago a proveedor
  date: string; // yyyy-mm-dd
  bankAccountId: string;
  paymentMethod: string; // ej: "transfer"
  currencyCode: string; // ej: "USD"
  costCenterId?: string;
  observations?: string;
  applications: { id: string; amount: number }[]; // facturas de compra (bills) o de venta (invoices) a aplicar
}

function isDryRun(): boolean {
  return (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
}

export class AlegraClient {
  private http: AxiosInstance;

  constructor() {
    const email = process.env.ALEGRA_EMAIL;
    const token = process.env.ALEGRA_TOKEN;
    const baseURL = process.env.ALEGRA_BASE_URL || "https://api.alegra.com/api/v1";

    if (!email || !token) {
      // eslint-disable-next-line no-console
      console.warn("[alegraClient] ALEGRA_EMAIL/ALEGRA_TOKEN no configurados. Configúralos en .env.");
    }

    const authHeader = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");

    this.http = axios.create({
      baseURL,
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      timeout: 15000,
    });
  }

  async searchContacts(query: string): Promise<AlegraContact[]> {
    const { data } = await this.http.get("/contacts", { params: { name: query, limit: 20 } });
    return (data as any[]).map((c) => ({ id: String(c.id), name: c.name, identification: c.identification }));
  }

  async getBankAccounts(): Promise<AlegraBankAccount[]> {
    const { data } = await this.http.get("/bank-accounts");
    return (data as any[]).map((a) => ({ id: String(a.id), name: a.name }));
  }

  async getCostCenters(): Promise<AlegraCostCenter[]> {
    const { data } = await this.http.get("/cost-centers");
    return (data as any[]).map((c) => ({ id: String(c.id), name: c.name }));
  }

  /** Facturas de compra (proveedor) pendientes de pago para un contacto. */
  async getPendingBills(contactId: string): Promise<AlegraPendingDocument[]> {
    const { data } = await this.http.get("/bills", {
      params: { client_id: contactId, status: "open" },
    });
    return (data as any[]).map((b) => ({
      id: String(b.id),
      numberTemplate: b.numberTemplate?.fullNumber ?? b.numberTemplate?.number,
      date: b.date,
      dueDate: b.dueDate,
      total: Number(b.total),
      balance: Number(b.balance ?? b.total),
    }));
  }

  /** Facturas de venta (cliente) pendientes de cobro para un contacto. */
  async getPendingInvoices(contactId: string): Promise<AlegraPendingDocument[]> {
    const { data } = await this.http.get("/invoices", {
      params: { client_id: contactId, status: "open" },
    });
    return (data as any[]).map((inv) => ({
      id: String(inv.id),
      numberTemplate: inv.numberTemplate?.fullNumber ?? inv.numberTemplate?.number,
      date: inv.date,
      dueDate: inv.dueDate,
      total: Number(inv.total),
      balance: Number(inv.balance ?? inv.total),
    }));
  }

  async createPayment(input: CreatePaymentInput): Promise<{ id: string; dryRun: boolean; payload: unknown }> {
    const payload = {
      date: input.date,
      bankAccount: { id: input.bankAccountId },
      paymentMethod: input.paymentMethod,
      currency: { code: input.currencyCode },
      ...(input.costCenterId ? { costCenter: { id: input.costCenterId } } : {}),
      ...(input.observations ? { observations: input.observations } : {}),
      type: input.direction,
      ...(input.direction === "out"
        ? { bills: input.applications.map((a) => ({ id: a.id, amount: a.amount })) }
        : { invoices: input.applications.map((a) => ({ id: a.id, amount: a.amount })) }),
    };

    if (isDryRun()) {
      // eslint-disable-next-line no-console
      console.log("[alegraClient] DRY_RUN activo, no se envía nada a Alegra. Payload:", JSON.stringify(payload, null, 2));
      return { id: "dry-run", dryRun: true, payload };
    }

    const { data } = await this.http.post("/payments", payload);
    return { id: String(data.id), dryRun: false, payload };
  }
}

export const alegraClient = new AlegraClient();
