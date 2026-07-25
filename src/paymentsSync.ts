import { db } from "./db";
import { alegraClient, AlegraOpenDocument } from "./alegraClient";

const SYNC_THROTTLE_MS = 5 * 60 * 1000; // no volver a consultar Alegra si sincronizamos hace menos de 5 minutos
const MAX_PAGES_PER_SYNC = 100; // cubre ~3000 pagos nuevos; evita un bucle infinito si la paginación no avanza

function getSyncState(key: string): string | null {
  const row = db.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSyncState(key: string, value: string) {
  db.prepare(
    "INSERT INTO sync_state (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value"
  ).run({ key, value });
}

const upsertPayment = db.prepare(`
  INSERT INTO alegra_payments (id, date, type, amount, contact_id, contact_name, number)
  VALUES (@id, @date, @type, @amount, @contact_id, @contact_name, @number)
  ON CONFLICT(id) DO UPDATE SET
    date = @date, type = @type, amount = @amount,
    contact_id = @contact_id, contact_name = @contact_name, number = @number
`);

/**
 * Trae de Alegra los pagos nuevos desde la última sincronización y los guarda
 * en la base de datos local, para no tener que volver a pedir todo el
 * historial cada vez que alguien abre la pantalla. Se salta si ya
 * sincronizamos hace menos de SYNC_THROTTLE_MS.
 *
 * Se para de paginar en cuanto encuentra un pago que ya tenemos guardado
 * (alcanzamos lo ya sincronizado) o uno anterior a `sinceDate` (la primera
 * vez, cuando la tabla está vacía). Incluye el mismo tope duro de páginas y
 * detección de página repetida que antes, por si la paginación de Alegra no
 * avanza.
 */
export async function syncRecentPayments(sinceDate: string): Promise<void> {
  const lastSync = getSyncState("payments_last_sync_at");
  if (lastSync && Date.now() - Number(lastSync) < SYNC_THROTTLE_MS) return;

  const newestKnown = db.prepare("SELECT id FROM alegra_payments ORDER BY date DESC, id DESC LIMIT 1").get() as
    | { id: string }
    | undefined;

  let start = 0;
  let previousFirstId: string | null = null;

  for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
    const items = await alegraClient.fetchPaymentsPage(start);
    if (items.length === 0) break;

    const firstId = String(items[0].id);
    if (firstId === previousFirstId) {
      // eslint-disable-next-line no-console
      console.warn("[paymentsSync] la paginación de /payments no avanzó, se corta para evitar un bucle.");
      break;
    }
    previousFirstId = firstId;

    let reachedKnownData = false;
    for (const p of items) {
      if (p.date < sinceDate || (newestKnown && String(p.id) === newestKnown.id)) {
        reachedKnownData = true;
        break;
      }
      upsertPayment.run({
        id: String(p.id),
        date: p.date,
        type: p.type,
        amount: Number(p.amount),
        contact_id: String(p.client?.id ?? ""),
        contact_name: p.client?.name ?? "—",
        number: p.numberTemplate?.fullNumber ?? p.number ?? null,
      });
    }

    if (reachedKnownData || items.length < 30) break;
    start += 30;
  }

  setSyncState("payments_last_sync_at", String(Date.now()));
}

/** Lee los pagos guardados localmente desde `sinceDate`, del tipo indicado. */
export function getCachedPayments(sinceDate: string, type: "in" | "out"): AlegraOpenDocument[] {
  const rows = db
    .prepare("SELECT * FROM alegra_payments WHERE type = ? AND date >= ? ORDER BY date DESC")
    .all(type, sinceDate) as any[];

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id ?? "",
    contactName: r.contact_name ?? "—",
    numberTemplate: r.number ?? undefined,
    date: r.date,
    total: r.amount,
    balance: r.amount,
  }));
}
