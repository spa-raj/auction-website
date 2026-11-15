import { maximumStartingPriceCents, maximumStartingPriceMessage, minimumStartingPriceMessage, invalidClosingTimeMessage, futureClosingTimeMessage } from '../../shared/auction';

type Result<T> = { success: true; value: T } | { success: false; message: string };

/** Add grouping without numeric conversion, preserving partial decimals and the logical caret. */
export function formatPriceInput(raw: string, caret = raw.length): { value: string; caret: number } {
  const plain = raw.replace(/,/g, '');
  if (!/^-?\d*(?:\.\d*)?$/.test(plain)) return { value: raw, caret };
  const negative = plain.startsWith('-');
  const unsigned = negative ? plain.slice(1) : plain;
  const [integer, fraction] = unsigned.split('.');
  const hasDecimal = fraction !== undefined;
  const whole = integer || (hasDecimal ? '0' : '');
  const value = (negative ? '-' : '') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (hasDecimal ? `.${fraction}` : '');
  let characters = raw.slice(0, caret).replace(/,/g, '').length;
  if (!integer && hasDecimal && caret > (negative ? 1 : 0)) characters++;
  let nextCaret = 0;
  while (nextCaret < value.length && characters > 0) {
    if (value[nextCaret] !== ',') characters--;
    nextCaret++;
  }
  return { value, caret: nextCaret };
}

export function parseStartingPrice(raw: string, badInput = false): Result<number> {
  if (badInput) return { success: false, message: 'Enter a valid USD amount with at most two decimal places.' };
  if (!raw.trim()) return { success: false, message: 'Enter a starting price.' };
  const match = /^(-?)(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return { success: false, message: 'Enter a valid USD amount with at most two decimal places.' };
  if (match[1]) return { success: false, message: minimumStartingPriceMessage };
  const dollars = match[2].replace(/,/g, '').replace(/^0+/, '') || '0';
  const maximumDollars = String(maximumStartingPriceCents / 100);
  // Reject oversized decimal strings before converting to a JavaScript number.
  if (dollars.length > maximumDollars.length || (dollars.length === maximumDollars.length && dollars > maximumDollars)) {
    return { success: false, message: maximumStartingPriceMessage };
  }
  const cents = Number(dollars) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  if (cents > maximumStartingPriceCents) return { success: false, message: maximumStartingPriceMessage };
  if (cents < 1) return { success: false, message: minimumStartingPriceMessage };
  return { success: true, value: cents };
}

export function parseClosingTime(raw: string, badInput = false, now = Date.now()): Result<string> {
  // A native datetime-local input can display an impossible/partial date while its value is empty.
  if (badInput) return { success: false, message: invalidClosingTimeMessage };
  if (!raw) return { success: false, message: 'Enter a closing date and time.' };
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(raw);
  if (!match) return { success: false, message: invalidClosingTimeMessage };
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(value => Number(value ?? '0'));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) {
    return { success: false, message: invalidClosingTimeMessage };
  }
  const date = new Date(raw);
  // Also reject local times normalized across a daylight-saving gap.
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) {
    return { success: false, message: invalidClosingTimeMessage };
  }
  if (date.getTime() <= now) return { success: false, message: futureClosingTimeMessage };
  return { success: true, value: date.toISOString() };
}
