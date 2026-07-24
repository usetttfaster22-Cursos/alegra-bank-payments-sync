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

export interface MatchSuggestion {
  contactId: string;
  contactName: string;
  documentId: string;
  numberTemplate?: string;
  date?: string;
  balance: number;
  score: number;
  matchedByName: boolean;
  matchedByAmount: boolean;
  matchedByDate: boolean;
}

const DATE_TOLERANCE_DAYS = 5;
const AMOUNT_TOLERANCE = 0.01;

/**
 * Sugiere qué factura de Alegra corresponde a un movimiento bancario, comparando
 * nombre del proveedor/cliente (contra la descripción del banco), fecha (+/- 5 días)
 * y monto pagado contra el saldo de la factura.
 */
export function suggestMatches(
  movement: { descripcion: string | null; fecha: string; amount: number },
  candidates: AlegraOpenDocument[]
): MatchSuggestion[] {
  const description = movement.descripcion ?? "";

  const suggestions = candidates
    .map((doc) => {
      const nScore = nameScore(doc.contactName, description);
      const dateDiff = doc.date ? daysBetween(movement.fecha, doc.date) : Infinity;
      const matchedByDate = dateDiff <= DATE_TOLERANCE_DAYS;
      const matchedByAmount = Math.abs(doc.balance - movement.amount) <= AMOUNT_TOLERANCE;
      const matchedByName = nScore >= 0.5;

      if (!matchedByName && !matchedByAmount) return null;

      const amountCloseness = 1 / (1 + Math.abs(doc.balance - movement.amount));
      const dateCloseness = matchedByDate ? 1 - dateDiff / (DATE_TOLERANCE_DAYS + 1) : 0;
      const score = nScore * 0.5 + amountCloseness * 0.3 + dateCloseness * 0.2;

      const suggestion: MatchSuggestion = {
        contactId: doc.contactId,
        contactName: doc.contactName,
        documentId: doc.id,
        numberTemplate: doc.numberTemplate,
        date: doc.date,
        balance: doc.balance,
        score,
        matchedByName,
        matchedByAmount,
        matchedByDate,
      };
      return suggestion;
    })
    .filter((s): s is MatchSuggestion => s !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return suggestions;
}
