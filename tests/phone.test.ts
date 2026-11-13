import { describe, expect, it } from 'vitest';
import { parsePhone, resolvePhone } from '../src/domain/phone';

describe('parsePhone', () => {
  it.each([
    ['+971501234567', '+971501234567', 'AE'],
    ['971501234567', '+971501234567', 'AE'],
    ['+966551234567', '+966551234567', 'SA'],
    ['966551234567', '+966551234567', 'SA'],
    ['+97331234567', '+97331234567', 'BH'],
    ['97331234567', '+97331234567', 'BH'],
    ['+971 (50) 123-4567', '+971501234567', 'AE'],
  ])('reads %s as international %s (%s)', (raw, e164, country) => {
    expect(parsePhone(raw)).toEqual({ kind: 'international', e164, country });
  });

  it.each(['0501234567', '055 123 4567', '(050) 123-4567', '31234567', '3123 4567'])(
    'reads %s as national',
    (raw) => {
      expect(parsePhone(raw).kind).toBe('national');
    },
  );

  it.each([
    ['empty', ''],
    ['only separators', ' - ( ) '],
    ['00 prefix', '00971501234567'],
    ['trunk 0 after dial code', '+9710501234567'],
    ['trunk 0 after dial code, no plus', '9710501234567'],
    ['too short', '+9715012345'],
    ['too long', '9715012345678'],
    ['dot separator', '050-123.4567'],
    ['slash separator', '050/1234567'],
    ['letter O', '05O1234567'],
    ['plus in the middle', '971+501234567'],
    ['two plus signs', '++971501234567'],
    ['unknown dial code', '+201001234567'],
    ['AE landline', '+97141234567'],
    ['AE national landline', '041234567'],
    ['BH number without leading 3', '+97361234567'],
    ['national with trunk but wrong length', '05012345'],
    ['tab character', '050\t1234567'],
    ['plus only', '+'],
  ])('rejects %s (%s)', (_label, raw) => {
    expect(parsePhone(raw)).toEqual({ kind: 'invalid' });
  });
});

describe('resolvePhone', () => {
  it('reads a national number in the given country', () => {
    expect(resolvePhone(parsePhone('0501234567'), 'AE')).toBe('+971501234567');
    expect(resolvePhone(parsePhone('0551234567'), 'SA')).toBe('+966551234567');
    expect(resolvePhone(parsePhone('31234567'), 'BH')).toBe('+97331234567');
  });

  it('rejects a national number that is not a mobile of the given country', () => {
    expect(resolvePhone(parsePhone('0501234567'), 'BH')).toBeNull();
    expect(resolvePhone(parsePhone('31234567'), 'AE')).toBeNull();
  });

  it('keeps an international number whatever the country', () => {
    expect(resolvePhone(parsePhone('+966551234567'), 'AE')).toBe('+966551234567');
  });

  it('returns null for an invalid phone', () => {
    expect(resolvePhone(parsePhone('abc'), 'AE')).toBeNull();
  });
});
