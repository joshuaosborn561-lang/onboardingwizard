function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: numberEnv('PORT', 8080),
  dataDir: optional('DATA_DIR', './data'),
  publicBaseUrl: optional('PUBLIC_BASE_URL'),
  geminiApiKey: () => required('GEMINI_API_KEY'),
  geminiModel: () => optional('GEMINI_MODEL', 'gemini-2.5-flash'),
  /** Main Porkbun account — used for every client (no subaccounts). */
  porkbunApiKey: () => optional('PORKBUN_API_KEY'),
  porkbunSecretApiKey: () => optional('PORKBUN_SECRET_API_KEY'),
  inboxkitApiKey: () => required('INBOXKIT_API_KEY'),
  smartleadApiKey: () => required('SMARTLEAD_API_KEY'),
  /** Smartlead dashboard login — required for InboxKit Microsoft→Smartlead OAuth export. */
  smartleadLogin: () => optional('SMARTLEAD_LOGIN'),
  smartleadPassword: () => optional('SMARTLEAD_PASSWORD'),
  slackBotToken: () => required('SLACK_BOT_TOKEN'),
  slackChannelId: () => required('SLACK_CHANNEL_ID'),
  domainForwardingBaseUrl: () => optional('DOMAIN_FORWARDING_BASE_URL'),
  registrant: {
    firstName: () => optional('REGISTRANT_FIRST_NAME', 'Agency'),
    lastName: () => optional('REGISTRANT_LAST_NAME', 'Ops'),
    email: () => optional('REGISTRANT_EMAIL'),
    phone: () => optional('REGISTRANT_PHONE', '+10000000000'),
    organization: () => optional('REGISTRANT_ORG', 'Agency'),
    address1: () => optional('REGISTRANT_ADDRESS1', '1 Main St'),
    city: () => optional('REGISTRANT_CITY', 'Wilmington'),
    state: () => optional('REGISTRANT_STATE', 'DE'),
    country: () => optional('REGISTRANT_COUNTRY', 'US'),
    postal: () => optional('REGISTRANT_POSTAL', '19801'),
  },
  warmup: {
    totalPerDay: numberEnv('WARMUP_TOTAL_PER_DAY', 20),
    dailyRampup: numberEnv('WARMUP_DAILY_RAMPUP', 5),
    replyRatePercentage: numberEnv('WARMUP_REPLY_RATE_PERCENTAGE', 30),
    maxEmailPerDay: numberEnv('MAX_EMAIL_PER_DAY', 40),
  },
};

export function webhookBaseUrl(): string {
  if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  throw new Error(
    'PUBLIC_BASE_URL (or RAILWAY_PUBLIC_DOMAIN) is required so InboxKit can reach the webhook',
  );
}
