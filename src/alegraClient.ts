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

export interface AlegraOpenDocument extends AlegraPendingDocument {
  contactId: string;
  contactName: string;
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

  /** Todas las facturas de compra abiertas (cuentas por pagar), de todos los proveedores. */
  async getAllOpenBills(): Promise<AlegraOpenDocument[]> {
    return this.cached("bills", () => this.fetchAllOpen("/bills"));
  }

  /** Todas las facturas de venta abiertas (cuentas por cobrar), de todos los clientes. */
  async getAllOpenInvoices(): Promise<AlegraOpenDocument[]> {
    return this.cached("invoices", () => this.fetchAllOpen("/invoices"));
  }

  private cacheStore = new Map<string, { at: number; data: AlegraOpenDocument[] }>();

  private async cached(key: string, fetcher: () => Promise<AlegraOpenDocument[]>): Promise<AlegraOpenDocument[]> {
    const ttlMs = 60_000;
    const hit = this.cacheStore.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    const data = await fetcher();
    this.cacheStore.set(key, { at: Date.now(), data });
    return data;
  }

  private async fetchAllOpen(path: "/bills" | "/invoices"): Promise<AlegraOpenDocument[]> {
    const limit = 30;
    let start = 0;
    const all: any[] = [];
    while (true) {
      const { data } = await this.http.get(path, { params: { status: "open", limit, start } });
      const page = data as any[];
      all.push(...page);
      if (page.length < limit) break;
      start += limit;
    }
    return all.map((b) => ({
      id: String(b.id),
      contactId: String(b.client?.id ?? b.provider?.id ?? ""),
      contactName: b.client?.name ?? b.provider?.name ?? "—",
      numberTemplate: b.numberTemplate?.fullNumber ?? b.numberTemplate?.number,
      date: b.date,
      dueDate: b.dueDate,
      total: Number(b.total),
      balance: Number(b.balance ?? b.total),
    }));
  }

  private paymentsCache: { at: number; key: string; data: AlegraOpenDocument[] } | null = null;

  /**
   * Pagos ya registrados en Alegra desde `sinceDate`, del tipo indicado
   * ("out" = pagos a proveedores, "in" = cobros de clientes), devueltos con
   * la misma forma que AlegraOpenDocument para reutilizar la lógica de
   * comparación. Se pide el listado ordenado por fecha descendente y se para
   * de paginar en cuanto aparece un pago anterior a `sinceDate` (no
   * encontramos un filtro de fecha que funcione en la API, pero el orden
   * descendente sí).
   */
  async getPaymentsSince(sinceDate: string, type: "in" | "out"): Promise<AlegraOpenDocument[]> {
    const cacheKey = `${sinceDate}:${type}`;
    const ttlMs = 60_000;
    if (this.paymentsCache && this.paymentsCache.key === cacheKey && Date.now() - this.paymentsCache.at < ttlMs) {
      return this.paymentsCache.data;
    }

    const limit = 30;
    let start = 0;
    const collected: AlegraOpenDocument[] = [];
    while (true) {
      const { data } = await this.http.get("/payments", {
        params: { order_field: "date", order_direction: "DESC", limit, start },
      });
      const page = data as any[];
      if (page.length === 0) break;

      let hitOlder = false;
      for (const p of page) {
        if (p.date < sinceDate) {
          hitOlder = true;
          break;
        }
        if (p.type !== type) continue;
        collected.push({
          id: String(p.id),
          contactId: String(p.client?.id ?? ""),
          contactName: p.client?.name ?? "—",
          numberTemplate: p.numberTemplate?.fullNumber ?? p.number,
          date: p.date,
          total: Number(p.amount),
          balance: Number(p.amount),
        });
      }
      if (hitOlder || page.length < limit) break;
      start += limit;
    }

    this.paymentsCache = { at: Date.now(), key: cacheKey, data: collected };
    return collected;
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
