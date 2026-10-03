import { CHICAGO_TIME_ZONE, isChicagoWeekday } from './standards.js';

export function chicagoDateParts(at: Date = new Date()): {
  weekday: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value || '';
  return {
    weekday: get('weekday'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** Daily sweep window: 8am hour in America/Chicago (cron may fire 13:26 or 14:26 UTC). */
export function isChicagoSweepWindow(at: Date = new Date()): boolean {
  if (!isChicagoWeekday(at)) return false;
  return chicagoDateParts(at).hour === 8;
}

/** Weekday retry/chase hours (8:00–18:59 America/Chicago). */
export function isChicagoBusinessHours(at: Date = new Date()): boolean {
  if (!isChicagoWeekday(at)) return false;
  const { hour } = chicagoDateParts(at);
  return hour >= 8 && hour <= 18;
}
