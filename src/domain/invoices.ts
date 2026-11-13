import { COUNTRIES, type CountryCode } from './countries';
import { type CalendarDate, dayNumber, daysBetween, dueDateAt, formatDate, monthIndex } from './dates';
import { roundHalfUp, vatOn } from './money';

/** Everything needed to compute an agreement's invoices. */
export interface Schedule {
  country: CountryCode;
  monthly: number;
  joiningFee: number;
  startDate: CalendarDate;
  dueDay: number;
}

export interface Invoice {
  invoice_no: number;
  due_date: string;
  kind: 'FIRST' | 'MONTHLY';
  proration: { days: number; cycle_days: number } | null;
  net: number;
  vat: number;
  total: number;
  currency: string;
}

/**
 * Month index of N, the first due date strictly after the start date.
 * Invoice 2 is due in this month, invoice k in month (nIndex + k - 2).
 */
function firstCycleMonth(schedule: Schedule): number {
  const { year, month, day } = schedule.startDate;
  const startMonth = monthIndex(year, month);
  const dueThisMonth = dueDateAt(startMonth, schedule.dueDay);
  return dueThisMonth.day > day ? startMonth : startMonth + 1;
}

function priced(base: Omit<Invoice, 'vat' | 'total' | 'net' | 'currency'>, net: bigint, schedule: Schedule): Invoice {
  const vat = vatOn(net, schedule.country);
  return {
    ...base,
    net: Number(net),
    vat: Number(vat),
    total: Number(net + vat),
    currency: COUNTRIES[schedule.country].currency,
  };
}

function firstInvoice(schedule: Schedule): Invoice {
  const nIndex = firstCycleMonth(schedule);
  const n = dueDateAt(nIndex, schedule.dueDay);
  // P comes from the due_day anchor one month before N, not from N's day number.
  const p = dueDateAt(nIndex - 1, schedule.dueDay);
  const days = daysBetween(schedule.startDate, n);
  const cycleDays = daysBetween(p, n);
  const prorated = roundHalfUp(BigInt(schedule.monthly) * BigInt(days), BigInt(cycleDays));
  return priced(
    {
      invoice_no: 1,
      due_date: formatDate(schedule.startDate),
      kind: 'FIRST',
      proration: { days, cycle_days: cycleDays },
    },
    prorated + BigInt(schedule.joiningFee),
    schedule,
  );
}

/**
 * Invoices whose due_date is in [from, to], both inclusive, in due date order.
 * Computed on every call and never stored. The schedule never ends, and
 * invoice_no always counts from the start of the agreement.
 */
export function invoicesBetween(schedule: Schedule, from: CalendarDate, to: CalendarDate): Invoice[] {
  const fromDay = dayNumber(from);
  const toDay = dayNumber(to);
  const inRange = (date: CalendarDate) => dayNumber(date) >= fromDay && dayNumber(date) <= toDay;
  const invoices: Invoice[] = [];

  if (inRange(schedule.startDate)) invoices.push(firstInvoice(schedule));

  const nIndex = firstCycleMonth(schedule);
  const firstMonth = Math.max(nIndex, monthIndex(from.year, from.month));
  const lastMonth = monthIndex(to.year, to.month);
  for (let index = firstMonth; index <= lastMonth; index++) {
    const dueDate = dueDateAt(index, schedule.dueDay);
    if (!inRange(dueDate)) continue;
    invoices.push(
      priced(
        { invoice_no: index - nIndex + 2, due_date: formatDate(dueDate), kind: 'MONTHLY', proration: null },
        BigInt(schedule.monthly),
        schedule,
      ),
    );
  }
  return invoices;
}
