import { COUNTRIES, COUNTRY_CODES, type CountryCode } from './countries';

/**
 * Result of reading a raw phone string, before any country context is applied.
 * - international: spelling A (+971…) or B (971…), already in E.164.
 * - national: spelling C (050…, 3…); needs a country to become E.164.
 */
export type ParsedPhone =
  | { kind: 'international'; e164: string; country: CountryCode }
  | { kind: 'national'; digits: string }
  | { kind: 'invalid' };

const INVALID: ParsedPhone = { kind: 'invalid' };

/** Removes the separators the brief allows: spaces, hyphens and round brackets. */
function clean(raw: string): string {
  return raw.replace(/[ ()-]/g, '');
}

function nationalMobile(digits: string, code: CountryCode): string | null {
  const { trunk, mobile } = COUNTRIES[code];
  if (!digits.startsWith(trunk)) return null;
  const rest = digits.slice(trunk.length);
  return mobile.test(rest) ? rest : null;
}

export function parsePhone(raw: string): ParsedPhone {
  const phone = clean(raw);
  if (!/^\+?\d+$/.test(phone)) return INVALID;
  if (phone.startsWith('00')) return INVALID;

  const hasPlus = phone.startsWith('+');
  const digits = hasPlus ? phone.slice(1) : phone;

  for (const code of COUNTRY_CODES) {
    const { dial, mobile } = COUNTRIES[code];
    if (digits.startsWith(dial) && mobile.test(digits.slice(dial.length))) {
      return { kind: 'international', e164: `+${digits}`, country: code };
    }
  }
  if (hasPlus) return INVALID;

  const isNationalSomewhere = COUNTRY_CODES.some((code) => nationalMobile(digits, code) !== null);
  return isNationalSomewhere ? { kind: 'national', digits } : INVALID;
}

/**
 * Turns a parsed phone into E.164. A national number is read in `country`;
 * an international number keeps its own country. Returns null when invalid.
 */
export function resolvePhone(parsed: ParsedPhone, country: CountryCode): string | null {
  if (parsed.kind === 'invalid') return null;
  if (parsed.kind === 'international') return parsed.e164;
  const mobile = nationalMobile(parsed.digits, country);
  return mobile === null ? null : `+${COUNTRIES[country].dial}${mobile}`;
}
