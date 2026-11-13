/**
 * The three supported countries. Every per-country rule (dial code, currency,
 * VAT, mobile shape) lives in this one table.
 */
export const COUNTRY_CODES = ['AE', 'SA', 'BH'] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export interface Country {
  code: CountryCode;
  dial: string;
  currency: string;
  /** Minor units per major unit (fils or halalas). */
  minorUnit: number;
  /** VAT rate as an exact fraction: num / den. */
  vat: { num: number; den: number };
  /** Mobile number as it follows the dial code (no trunk 0). */
  mobile: RegExp;
  /** Prefix of the national form ('0' for AE/SA, none for BH). */
  trunk: string;
}

export const COUNTRIES: Record<CountryCode, Country> = {
  AE: { code: 'AE', dial: '971', currency: 'AED', minorUnit: 100, vat: { num: 5, den: 100 }, mobile: /^5\d{8}$/, trunk: '0' },
  SA: { code: 'SA', dial: '966', currency: 'SAR', minorUnit: 100, vat: { num: 15, den: 100 }, mobile: /^5\d{8}$/, trunk: '0' },
  BH: { code: 'BH', dial: '973', currency: 'BHD', minorUnit: 1000, vat: { num: 10, den: 100 }, mobile: /^3\d{7}$/, trunk: '' },
};
