import { describe, expect, it } from 'vitest';
import { parseStartingPrice, parseClosingTime, formatPriceInput } from './auction-form';

const now = Date.parse('2026-11-15T00:00:00Z');
describe('posting amount validation', () => {
  it.each(['9'.repeat(40), '1000001', '1000000.01', '1,000,000.01', '9'.repeat(500)])('rejects oversized amount %s with the product limit', raw => {
    expect(parseStartingPrice(raw)).toEqual({success:false,message:'The starting price must be at most $1,000,000.'});
  });
  it.each([['0.01',1], ['149.99',14999], ['1000000',100000000], ['1,234.56',123456], ['1,000,000.00',100000000], ['000001.20',120]])('parses %s as exact cents', (raw,cents) => {
    expect(parseStartingPrice(String(raw))).toEqual({success:true,value:cents});
  });
  it.each(['0', '-1', '0.00'])('rejects below-minimum amount %s', raw => {
    expect(parseStartingPrice(raw)).toEqual({success:false,message:'The starting price must be at least $0.01.'});
  });
  it('distinguishes missing amounts from malformed/overprecise amounts', () => {
    expect(parseStartingPrice('')).toEqual({success:false,message:'Enter a starting price.'});
    for (const raw of ['abc','1.001','1e6','1,23.45']) expect(parseStartingPrice(raw)).toEqual({success:false,message:'Enter a valid USD amount with at most two decimal places.'});
  });
});
describe('posting closing date validation', () => {
  it.each(['2027-02-31T14:30','2027-02-29T14:30','2020-02-31T14:30','2027-13-01T14:30','2027-01-01T24:00'])('rejects impossible date %s without suggesting a future date', raw => {
    expect(parseClosingTime(raw,false,now)).toEqual({success:false,message:'Enter a valid closing date and time.'});
  });
  it('distinguishes an empty input from an invalid native date entry with an empty value', () => {
    expect(parseClosingTime('',false,now)).toEqual({success:false,message:'Enter a closing date and time.'});
    expect(parseClosingTime('',true,now)).toEqual({success:false,message:'Enter a valid closing date and time.'});
  });
  it('only asks for a future date when a real date is in the past', () => {
    expect(parseClosingTime('2020-01-01T14:30',false,now)).toEqual({success:false,message:'Choose a future closing date and time.'});
  });
  it('accepts a real leap day and converts a valid local time to UTC', () => {
    const raw = '2028-02-29T14:30';
    expect(parseClosingTime(raw,false,now)).toEqual({success:true,value:new Date(raw).toISOString()});
  });
});

describe('price grouping while editing', () => {
  it.each([
    ['1000','1,000'], ['123456.78','123,456.78'], ['1000.','1,000.'],
    ['1234.00','1,234.00'], ['1,234.50','1,234.50'], ['',''], ['.5','0.5'],
    ['12abc','12abc'],
  ])('formats %s as %s without losing decimal input', (raw, value) => {
    expect(formatPriceInput(raw)).toEqual({value,caret:value.length});
  });
  it('keeps the caret beside a digit inserted in the middle', () => {
    expect(formatPriceInput('1,2934.56',4)).toEqual({value:'12,934.56',caret:4});
  });
});
