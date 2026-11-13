/**
 * Pure calendar arithmetic on (year, month, day). No `Date` objects, so there
 * is no time zone and no system clock anywhere in the business logic.
 */
export interface CalendarDate {
  year: number;
  /** 1 to 12. */
  month: number;
  /** 1 to days_in_month. */
  day: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Strict `YYYY-MM-DD` that must be a real calendar day, otherwise null. */
export function parseDate(text: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatDate({ year, month, day }: CalendarDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Days since 1970-01-01 in the proleptic Gregorian calendar
 * (Howard Hinnant's days_from_civil). Only differences of this number matter.
 */
export function dayNumber({ year, month, day }: CalendarDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Calendar days from `a` to `b` (negative when b is before a). */
export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return dayNumber(b) - dayNumber(a);
}

/** Months counted from year 0, so consecutive months differ by 1. */
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** The due date in the month at `index`: min(due_day, days_in_month). */
export function dueDateAt(index: number, dueDay: number): CalendarDate {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return dueDateIn(year, month, dueDay);
}

export function dueDateIn(year: number, month: number, dueDay: number): CalendarDate {
  return { year, month, day: Math.min(dueDay, daysInMonth(year, month)) };
}
