import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvCell, toCsv } from '../src/services/csvExport.js';

test('CSV cells escape quotes and neutralize spreadsheet formulas', () => {
  assert.equal(escapeCsvCell('=1+1'), '"\'=1+1"');
  assert.equal(escapeCsvCell(' \t@SUM(A1:A2)'), '"\' \t@SUM(A1:A2)"');
  assert.equal(escapeCsvCell('a,"b"'), '"a,""b"""');
  assert.equal(escapeCsvCell(-12), '"-12"');
});

test('CSV serialization quotes headers and data rows', () => {
  assert.equal(toCsv(['Name', 'Value'], [['switch, west', '=2+2']]), `"Name","Value"\r\n"switch, west","'=2+2"`);
});
