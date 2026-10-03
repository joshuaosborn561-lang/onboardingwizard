import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isChicagoWeekday } from './standards.js';
import { isChicagoBusinessHours, isChicagoSweepWindow } from './chicagoTime.js';

test('Chicago sweep window is weekday 8am hour only', () => {
  const saturday = new Date('2026-10-03T18:00:00Z');
  const mondaySweep = new Date('2026-10-05T13:26:00Z'); // 08:26 CDT
  const mondayAfternoon = new Date('2026-10-05T20:26:00Z'); // 15:26 CDT
  assert.equal(isChicagoWeekday(saturday), false);
  assert.equal(isChicagoSweepWindow(saturday), false);
  assert.equal(isChicagoSweepWindow(mondaySweep), true);
  assert.equal(isChicagoSweepWindow(mondayAfternoon), false);
  assert.equal(isChicagoBusinessHours(mondaySweep), true);
  assert.equal(isChicagoBusinessHours(mondayAfternoon), true);
  assert.equal(isChicagoBusinessHours(saturday), false);
});
