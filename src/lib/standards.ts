/**
 * Josh’s onboarding STANDARDS, encoded for code (not just docs).
 *
 * Binding copy lives in ONBOARDING_SOP.md and AGENTS.md. Do not weaken
 * spend gates to “make this compile.” Do not spend, cancel, or touch
 * Smartlead campaigns / PODs / PowerGRYD from helpers here.
 */

/** Max senders per sending domain. New jobs plan exactly this many. */
export const INBOXES_PER_DOMAIN = 2;

/** Smartlead client that onboarding must never read or write. */
export const POWERGRYD_SMARTLEAD_CLIENT_ID = 592842;

export const CHICAGO_TIME_ZONE = 'America/Chicago';

/** Daily IK ↔ Smartlead ↔ Porkbun sweep local time. Weekdays only. */
export const WEEKDAY_SWEEP_LOCAL_TIME = '08:26';

/**
 * InboxKit never clears `scheduled_for_cancellation` seats from its UI.
 * Sweep stores due = cancel/renewal date + this many days, then cleans up
 * on/after that date (weekdays only). Never delete the Porkbun domain.
 */
export const SCHEDULED_CANCEL_DUE_OFFSET_DAYS = 1;

/** Railway / cron: Mon–Fri. Nothing runs Saturday or Sunday (Chicago). */
export const WEEKDAY_CRON_DOW = '1-5';

/** Slack / status dumps: counts plus at most this many samples. */
export const STATUS_SAMPLE_CAP = 10;

/**
 * Domain reputation: a SURBL listing is acceptable.
 * Any other blacklist listing is a blocker (check not implemented yet).
 */
export const IGNORED_BLACKLISTS = ['SURBL'] as const;

/** InboxKit workspace that the inventory sweep must include. */
export const DW_GENERIC_WORKSPACE_NAME = 'DW Generic';

export const SMARTLEAD_SIGNATURE_NAME_LINE = 'First Last';

export function parseSmartleadClientId(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function isPowerGrydClientId(clientId: unknown): boolean {
  return parseSmartleadClientId(clientId) === POWERGRYD_SMARTLEAD_CLIENT_ID;
}

/** Shapes Smartlead uses for an account's current client tag. */
export type SmartleadClientTagged = {
  client_id?: unknown;
  clientId?: unknown;
  client?: { id?: unknown } | null;
};

export function accountClientId(
  account: SmartleadClientTagged | null | undefined,
): number | undefined {
  if (!account) return undefined;
  return parseSmartleadClientId(account.client_id ?? account.clientId ?? account.client?.id);
}

/** True when this account is already tagged to PowerGRYD. */
export function isPowerGrydAccount(account: SmartleadClientTagged | null | undefined): boolean {
  return isPowerGrydClientId(accountClientId(account));
}

/** Refuse any mutation path that would target PowerGRYD as a destination. */
export function assertNotPowerGryd(clientId: unknown): void {
  if (isPowerGrydClientId(clientId)) {
    throw new Error(
      `Refusing to touch PowerGRYD (Smartlead client ${POWERGRYD_SMARTLEAD_CLIENT_ID})`,
    );
  }
}

/**
 * Refuse warmup / signature / rename / delete / tag on an account that is
 * already tagged 592842 — not just assignment *to* PowerGRYD.
 */
export function assertAccountNotPowerGryd(account: SmartleadClientTagged | null | undefined): void {
  if (isPowerGrydAccount(account)) {
    throw new Error(
      `Refusing to mutate an account tagged PowerGRYD (Smartlead client ${POWERGRYD_SMARTLEAD_CLIENT_ID})`,
    );
  }
}

/**
 * True when `at` is Monday–Friday in America/Chicago.
 * STANDARDS: nothing runs Saturday or Sunday.
 */
export function isChicagoWeekday(at: Date = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIME_ZONE,
    weekday: 'short',
  }).format(at);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

/** Webhooks may record mailbox state anytime, but must not advance jobs on Sat/Sun. */
export function webhookMayAdvanceJobs(at: Date = new Date()): boolean {
  return isChicagoWeekday(at);
}

export function capSamples<T>(items: readonly T[], cap = STATUS_SAMPLE_CAP): T[] {
  return items.slice(0, cap);
}
