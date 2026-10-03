/** Max senders per sending domain. New jobs plan exactly this many. */
export { INBOXES_PER_DOMAIN } from './standards.js';
import { INBOXES_PER_DOMAIN } from './standards.js';

export function inboxesForDomains(domainCount: number): number {
  return Math.max(0, domainCount) * INBOXES_PER_DOMAIN;
}

export function domainsForInboxes(inboxCount: number): number {
  if (inboxCount <= 0) return 0;
  return Math.ceil(inboxCount / INBOXES_PER_DOMAIN);
}
