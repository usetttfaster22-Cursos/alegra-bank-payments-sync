import { AlegraOpenDocument } from "./alegraClient";

const STOPWORDS = new Set([
  "s.a", "sa", "s.a.", "corp", "corp.", "inc", "inc.", "ltda", "ltd", "s de rl",
  "sociedad", "anonima", "anónima", "group", "grupo", "company", "co", "the",
  "de", "del", "la", "el", "los", "las", "y", "e",
]);

function normalize(text: string): string {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(name: string): string[] {
  return normalize(name)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
}

function nameScore(contactName: string, description: string): number {
  const words = significantWords(contactName);
  if (words.length === 0) return 0;
  const normDescription = normalize(description);
  const matched = words.filter((w) => normDescription.includes(w));
  return matched.length / words.length;
}

function daysBetween(a: string, b: string): number {
  const diffMs = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return diffMs / (1000 * 60 * 60 * 24);
}

export interface MovementLike {
  descripcion: string | null;
  fecha: string;
  amount: number;
}

export interface MatchScore {
  score: number;
  matchedByName: boolean;
  matchedByAmount: boolean;
  matchedByDate: boolean;
}

export interface MatchSuggestion extends MatchScore {
  contactId: string;
  contactName: string;
  documentId: string;
  numberTemplate?: string;
  date?: string;
  balance: number;
}

const DATE_TOLERANCE_DAYS = 5;
const AMOUNT_TOLERANCE = 0.01;

function scoreOne(movement: MovementLike, doc: AlegraOpenDocument): MatchScore {
  const description = movement.descripcion ?? "";
  const nScore = nameScore(doc.contactName, description);
  const dateDiff = doc.date ? daysBetween(movement.fecha, doc.date) : Infinity;
  const matchedByDate = dateDiff <= DATE_TOLERANCE_DAYS;
  const matchedByAmount = Math.abs(doc.balance - movement.amount) <= AMOUNT_TOLERANCE;
  const matchedByName = nScore >= 0.5;

  const amountCloseness = 1 / (1 + Math.abs(doc.balance - movement.amount));
  const dateCloseness = matchedByDate ? 1 - dateDiff / (DATE_TOLERANCE_DAYS + 1) : 0;
  const score = nScore * 0.5 + amountCloseness * 0.3 + dateCloseness * 0.2;

  return { score, matchedByName, matchedByAmount, matchedByDate };
}

/**
 * Sugiere qué factura de Alegra corresponde a un movimiento bancario, comparando
 * nombre del proveedor/cliente (contra la descripción del banco), fecha (+/- 5 días)
 * y monto pagado contra el saldo de la factura.
 */
export function suggestMatches(movement: MovementLike, candidates: AlegraOpenDocument[]): MatchSuggestion[] {
  return candidates
    .map((doc) => {
      const s = scoreOne(movement, doc);
      if (!s.matchedByName && !s.matchedByAmount) return null;
      const suggestion: MatchSuggestion = {
        contactId: doc.contactId,
        contactName: doc.contactName,
        documentId: doc.id,
        numberTemplate: doc.numberTemplate,
        date: doc.date,
        balance: doc.balance,
        ...s,
      };
      return suggestion;
    })
    .filter((s): s is MatchSuggestion => s !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * Indica si una factura abierta de Alegra parece tener ya un movimiento bancario
 * pendiente que la paga (para resaltarla en la vista de Cuentas por Pagar/Cobrar).
 * Exige al menos 2 de los 3 criterios (nombre, monto exacto, fecha cercana) para
 * evitar falsos positivos.
 */
export function findStrongBankMatch(doc: AlegraOpenDocument, movements: MovementLike[]): boolean {
  return movements.some((m) => {
    const s = scoreOne(m, doc);
    const criteriaMet = [s.matchedByName, s.matchedByAmount, s.matchedByDate].filter(Boolean).length;
    return criteriaMet >= 2;
  });
}
