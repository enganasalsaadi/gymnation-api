/**
 * Reconciliation of a gateway batch against the invoices expected in a month.
 * Pure: no I/O and no framework. The HTTP layer supplies the expected invoices
 * and a currency lookup taken from the store.
 */

export interface GatewayRow {
  gateway_txn_id: string;
  agreement_id: string;
  /** Minor units, VAT included. Compared with the invoice total. */
  amount: number;
  currency: string;
  status: 'SETTLED' | 'DECLINED';
  /** `YYYY-MM-DD`, already validated. */
  attempted_on: string;
}

/** An invoice of a stored agreement whose due_date falls in the month. */
export interface ExpectedInvoice {
  agreement_id: string;
  invoice_no: number;
  due_date: string;
  total: number;
  currency: string;
}

export type RowErrorCode = 'DUPLICATE_TXN' | 'ROW_OUTSIDE_MONTH' | 'CURRENCY_MISMATCH';

export interface RowError {
  gateway_txn_id: string;
  code: RowErrorCode;
}

export type Verdict = 'MATCHED' | 'DUE_DAY_DRIFT' | 'DOUBLE_CHARGE_RISK' | 'MISSING_FROM_LEDGER' | 'DECLINED';

export interface RowResult {
  gateway_txn_id: string;
  verdict: Verdict;
  invoice: { agreement_id: string; invoice_no: number } | null;
}

export interface Reconciliation {
  summary: Record<Verdict, number>;
  rows: RowResult[];
  unmatched_invoices: ExpectedInvoice[];
}

/** Largest difference, in minor units, between a row amount and an invoice total that still counts as a candidate. */
const AMOUNT_TOLERANCE = 1;

/**
 * Every row problem, in request row order. A row with several problems lists
 * them as DUPLICATE_TXN, ROW_OUTSIDE_MONTH, CURRENCY_MISMATCH.
 *
 * @param month `YYYY-MM`, already validated.
 * @param currencyOf the plan currency of a stored agreement, or undefined when the agreement is unknown.
 */
export function rowErrors(
  month: string,
  rows: GatewayRow[],
  currencyOf: (agreementId: string) => string | undefined,
): RowError[] {
  const timesSeen = new Map<string, number>();
  for (const row of rows) timesSeen.set(row.gateway_txn_id, (timesSeen.get(row.gateway_txn_id) ?? 0) + 1);

  const errors: RowError[] = [];
  for (const row of rows) {
    const add = (code: RowErrorCode) => errors.push({ gateway_txn_id: row.gateway_txn_id, code });
    if (timesSeen.get(row.gateway_txn_id)! > 1) add('DUPLICATE_TXN');
    if (!row.attempted_on.startsWith(`${month}-`)) add('ROW_OUTSIDE_MONTH');
    const expectedCurrency = currencyOf(row.agreement_id);
    if (expectedCurrency !== undefined && expectedCurrency !== row.currency) add('CURRENCY_MISMATCH');
  }
  return errors;
}

const invoiceKey = (agreementId: string, invoiceNo: number) => `${agreementId}#${invoiceNo}`;

/** The invoice a settled row links to: a total within 1 minor unit, earliest due date first. */
function candidateFor(row: GatewayRow, expectedByAgreement: Map<string, ExpectedInvoice[]>): ExpectedInvoice | undefined {
  const candidates = (expectedByAgreement.get(row.agreement_id) ?? []).filter(
    (invoice) => Math.abs(invoice.total - row.amount) <= AMOUNT_TOLERANCE,
  );
  // Due dates of one agreement are distinct, so this order has no ties.
  candidates.sort((a, b) => compare(a.due_date, b.due_date));
  return candidates[0];
}

/** Plain code-unit comparison, so the sort never depends on the locale. */
function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Matches rows to expected invoices and assigns a verdict to every row.
 * Each row picks its invoice on its own, so the result does not depend on the
 * order of the rows.
 */
export function reconcile(rows: GatewayRow[], expected: ExpectedInvoice[]): Reconciliation {
  const expectedByAgreement = new Map<string, ExpectedInvoice[]>();
  for (const invoice of expected) {
    const list = expectedByAgreement.get(invoice.agreement_id) ?? [];
    list.push(invoice);
    expectedByAgreement.set(invoice.agreement_id, list);
  }

  // Pass 1: link every settled row to at most one invoice.
  const links = rows.map((row) => (row.status === 'SETTLED' ? candidateFor(row, expectedByAgreement) : undefined));
  const settledRowsPerInvoice = new Map<string, number>();
  for (const invoice of links) {
    if (invoice === undefined) continue;
    const key = invoiceKey(invoice.agreement_id, invoice.invoice_no);
    settledRowsPerInvoice.set(key, (settledRowsPerInvoice.get(key) ?? 0) + 1);
  }

  // Pass 2: verdicts, now that every invoice knows how many settled rows it has.
  const results: RowResult[] = rows.map((row, index) => {
    if (row.status === 'DECLINED') return { gateway_txn_id: row.gateway_txn_id, verdict: 'DECLINED', invoice: null };
    const invoice = links[index];
    if (invoice === undefined) return { gateway_txn_id: row.gateway_txn_id, verdict: 'MISSING_FROM_LEDGER', invoice: null };
    const linkedRows = settledRowsPerInvoice.get(invoiceKey(invoice.agreement_id, invoice.invoice_no))!;
    const verdict: Verdict =
      linkedRows > 1 ? 'DOUBLE_CHARGE_RISK' : row.attempted_on === invoice.due_date ? 'MATCHED' : 'DUE_DAY_DRIFT';
    return {
      gateway_txn_id: row.gateway_txn_id,
      verdict,
      invoice: { agreement_id: invoice.agreement_id, invoice_no: invoice.invoice_no },
    };
  });

  const summary: Record<Verdict, number> = {
    MATCHED: 0,
    DUE_DAY_DRIFT: 0,
    DOUBLE_CHARGE_RISK: 0,
    MISSING_FROM_LEDGER: 0,
    DECLINED: 0,
  };
  for (const result of results) summary[result.verdict] += 1;

  const unmatched = expected
    .filter((invoice) => !settledRowsPerInvoice.has(invoiceKey(invoice.agreement_id, invoice.invoice_no)))
    .sort(
      (a, b) =>
        compare(a.due_date, b.due_date) || compare(a.agreement_id, b.agreement_id) || compare(a.invoice_no, b.invoice_no),
    )
    .map(({ agreement_id, invoice_no, due_date, total, currency }) => ({ agreement_id, invoice_no, due_date, total, currency }));

  return { summary, rows: results, unmatched_invoices: unmatched };
}
