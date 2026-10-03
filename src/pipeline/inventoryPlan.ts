import {
  DW_GENERIC_WORKSPACE_NAME,
  isPowerGrydClientId,
  POWERGRYD_SMARTLEAD_CLIENT_ID,
} from '../lib/standards.js';
import {
  GENERIC_CLIENT,
  GENERIC_SMARTLEAD_TAG,
  type LedgerClient,
  type LedgerProvider,
  type SeatLedgerRow,
} from '../store/seatLedger.js';

export type IkLifecycle = 'active' | 'cancelled' | 'scheduled_for_cancellation' | 'other';

export type Platform = 'GOOGLE' | 'MICROSOFT';

export interface IkSeat {
  uid: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  domain: string;
  platform: Platform;
  provider?: LedgerProvider;
  status: string;
  cancellationStatus?: string;
  lifecycle: IkLifecycle;
  firstName: string;
  lastName: string;
  username: string;
  sequencerStatus?: string;
  cancelDate?: string;
}

export interface SlAccount {
  id: number;
  email: string;
  clientId?: number;
  warmupEnabled?: boolean;
}

export type SweepActionType =
  | 'import_google'
  | 'export_microsoft'
  | 'tag_client'
  | 'enable_warmup'
  | 'delete_ik'
  | 'delete_sl'
  | 'porkbun_autorenew_off'
  | 'log_cancellation';

export type CancellationLogState = 'upcoming' | 'due' | 'deleted_IK' | 'deleted_SL';

export interface SweepAction {
  type: SweepActionType;
  email?: string;
  uid?: string;
  workspaceId?: string;
  workspaceName?: string;
  domain?: string;
  platform?: Platform;
  smartleadAccountId?: number;
  smartleadClientId?: number;
  reason: string;
  logState?: CancellationLogState;
  firstName?: string;
  lastName?: string;
  cancelDate?: string;
  /** Smartlead client company line — never the InboxKit workspace name. */
  clientName?: string;
  /** Named SL client or free-pool `generic`. */
  ledgerClient?: LedgerClient;
  genericDedicated?: boolean;
  slTags?: string[];
}

export interface SweepDecision {
  reason: string;
  email?: string;
  workspaceId?: string;
  workspaceName?: string;
  domain?: string;
}

export interface SweepSkip {
  reason: string;
  email?: string;
  workspaceId?: string;
  workspaceName?: string;
}

export function classifyIkLifecycle(
  status?: string,
  cancellationStatus?: string,
): IkLifecycle {
  const st = String(status || '')
    .toLowerCase()
    .replace(/\s+/g, '_');
  const cs = String(cancellationStatus || '')
    .toLowerCase()
    .replace(/\s+/g, '_');
  const blob = `${st} ${cs}`;
  const cancelled =
    st === 'cancelled' ||
    st === 'canceled' ||
    st === 'deleted' ||
    cs === 'cancelled' ||
    cs === 'canceled' ||
    cs === 'deleted';
  const scheduled =
    st === 'scheduled_for_cancellation' ||
    st.includes('scheduled_for_cancel') ||
    cs === 'scheduled' ||
    (blob.includes('cancel') && (cs === 'pending' || cs === 'processing'));
  if (scheduled && !cancelled) return 'scheduled_for_cancellation';
  if (cancelled) return 'cancelled';
  if (
    st === 'active' ||
    st === 'ready' ||
    st === 'connected' ||
    st === 'ok' ||
    st === 'warming' ||
    st === 'live'
  ) {
    return 'active';
  }
  return 'other';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function mailboxEmail(input: {
  email?: string;
  username?: string;
  domain_name?: string;
  domain?: string;
}): string {
  if (input.email?.includes('@')) return normalizeEmail(input.email);
  const user = String(input.username || '').trim();
  const domain = String(input.domain_name || input.domain || '').trim();
  if (user && domain) return normalizeEmail(`${user}@${domain}`);
  return normalizeEmail(input.email || '');
}

export function platformOf(raw?: string): Platform {
  const p = String(raw || '').toUpperCase();
  if (
    p.includes('MICROSOFT') ||
    p.includes('OUTLOOK') ||
    p === 'MS' ||
    p === 'M365' ||
    p.includes('OFFICE')
  ) {
    return 'MICROSOFT';
  }
  return 'GOOGLE';
}

export function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const left = norm(a);
  const right = norm(b);
  return Boolean(left && right && left === right);
}

export function domainOfEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

export interface SeatOwnership {
  known: boolean;
  client: LedgerClient | null;
  genericDedicated: boolean;
  powergryd: boolean;
}

/**
 * Map one seat to a known client (`generic` or a named SL id).
 * DW Generic is mixed — never a single workspace client.
 */
export function resolveSeatOwnership(input: {
  seat: IkSeat;
  matches: SlAccount[];
  mappedClient?: number;
  mixedWorkspace: boolean;
  existing?: SeatLedgerRow;
  powerGrydDomains?: Set<string>;
}): SeatOwnership {
  const { seat, matches, mappedClient, mixedWorkspace, existing } = input;
  const domain = (seat.domain || domainOfEmail(seat.email)).toLowerCase();
  const slNamed = matches
    .map((a) => a.clientId)
    .filter((id): id is number => id != null && Number.isFinite(id));
  const slHasPowerGryd = slNamed.some((id) => isPowerGrydClientId(id));
  const domainPowerGryd = Boolean(domain && input.powerGrydDomains?.has(domain));
  const powergryd =
    existing?.powergryd === true ||
    slHasPowerGryd ||
    isPowerGrydClientId(mappedClient) ||
    isPowerGrydClientId(existing?.client) ||
    domainPowerGryd;

  if (powergryd) {
    return {
      known: true,
      client: isPowerGrydClientId(existing?.client)
        ? (existing!.client as number)
        : slNamed.find((id) => isPowerGrydClientId(id)) ??
          (isPowerGrydClientId(mappedClient) ? mappedClient! : POWERGRYD_SMARTLEAD_CLIENT_ID),
      genericDedicated: existing?.generic_dedicated === true,
      powergryd: true,
    };
  }

  if (existing?.client === GENERIC_CLIENT) {
    return { known: true, client: GENERIC_CLIENT, genericDedicated: false, powergryd: false };
  }

  if (existing?.client != null && !isPowerGrydClientId(existing.client)) {
    return {
      known: true,
      client: existing.client,
      genericDedicated: existing.generic_dedicated === true,
      powergryd: false,
    };
  }

  if (mixedWorkspace) {
    const uniqueNamed = [...new Set(slNamed.filter((id) => !isPowerGrydClientId(id)))];
    if (uniqueNamed.length === 1) {
      return {
        known: true,
        client: uniqueNamed[0]!,
        genericDedicated: false,
        powergryd: false,
      };
    }
    if (matches.length > 0 && slNamed.length === 0) {
      return { known: true, client: GENERIC_CLIENT, genericDedicated: false, powergryd: false };
    }
    return { known: false, client: null, genericDedicated: false, powergryd: false };
  }

  if (mappedClient != null && !isPowerGrydClientId(mappedClient)) {
    return { known: true, client: mappedClient, genericDedicated: true, powergryd: false };
  }

  if (slNamed.length === 1 && !isPowerGrydClientId(slNamed[0])) {
    return {
      known: true,
      client: slNamed[0]!,
      genericDedicated: false,
      powergryd: false,
    };
  }

  return { known: false, client: null, genericDedicated: false, powergryd: false };
}

export function campaignLinkBlocksSlDelete(
  accountId: number,
  links?: Map<number, { linked: boolean; unknown: boolean }>,
): boolean {
  const verdict = links?.get(accountId);
  if (!verdict) return true;
  return verdict.linked || verdict.unknown;
}

export function powerGrydDomainsFromAccounts(accounts: SlAccount[]): Set<string> {
  const domains = new Set<string>();
  for (const account of accounts) {
    if (!isPowerGrydClientId(account.clientId)) continue;
    const domain = domainOfEmail(account.email);
    if (domain) domains.add(domain);
  }
  return domains;
}

export function planInventoryActions(input: {
  seats: IkSeat[];
  slAccounts: SlAccount[];
  workspaceClientId: Map<string, number>;
  /** Emails blocked by a pending per-job Smartlead load approval. */
  blockedEmails?: Set<string>;
  /** Workspaces that must never be treated as a single client (DW Generic). */
  mixedWorkspaceIds?: Set<string>;
  /** Domains used by PowerGRYD seats — exclude even when the seat is not in SL. */
  powerGrydDomains?: Set<string>;
  /** Smartlead client display names for signatures (not workspace names). */
  clientNameById?: Map<number, string>;
  /** Persisted ledger — used to honor `generic` and skip PowerGRYD flags. */
  ledgerByEmail?: Map<string, SeatLedgerRow>;
  /**
   * Campaign-link verdicts for lapse handoff. Missing / unknown is fail-closed
   * (treat as linked). Sweep never SL-deletes a campaign-linked seat.
   */
  campaignLinksByAccountId?: Map<number, { linked: boolean; unknown: boolean }>;
}): {
  actions: SweepAction[];
  needsDecision: SweepDecision[];
  skipped: SweepSkip[];
} {
  const actions: SweepAction[] = [];
  const needsDecision: SweepDecision[] = [];
  const skipped: SweepSkip[] = [];
  const blocked = input.blockedEmails ?? new Set<string>();
  const mixed = input.mixedWorkspaceIds ?? new Set<string>();
  const clientNames = input.clientNameById ?? new Map<number, string>();

  const slByEmail = new Map<string, SlAccount[]>();
  for (const account of input.slAccounts) {
    const email = normalizeEmail(account.email);
    if (!email) continue;
    const list = slByEmail.get(email) ?? [];
    list.push(account);
    slByEmail.set(email, list);
  }

  const powerGrydWorkspaces = new Set<string>();
  for (const [workspaceId, clientId] of input.workspaceClientId) {
    if (isPowerGrydClientId(clientId)) powerGrydWorkspaces.add(workspaceId);
  }
  const powerGrydDomains = new Set(input.powerGrydDomains ?? []);
  for (const domain of powerGrydDomainsFromAccounts(input.slAccounts)) {
    powerGrydDomains.add(domain);
  }

  const clientNameFor = (clientId?: number): string | undefined => {
    if (clientId == null) return undefined;
    return clientNames.get(clientId);
  };

  const ledger = input.ledgerByEmail ?? new Map<string, SeatLedgerRow>();
  const campaignLinks = input.campaignLinksByAccountId;

  const isPowerGrydSeat = (seat: IkSeat, matches: SlAccount[]): boolean => {
    const existing = ledger.get(normalizeEmail(seat.email));
    if (existing?.powergryd) return true;
    if (powerGrydWorkspaces.has(seat.workspaceId)) return true;
    if (matches.some((a) => isPowerGrydClientId(a.clientId))) return true;
    const domain = (seat.domain || domainOfEmail(seat.email)).toLowerCase();
    return Boolean(domain && powerGrydDomains.has(domain));
  };

  const importAction = (
    seat: IkSeat,
    email: string,
    ownership: SeatOwnership,
  ): SweepAction => {
    const namedId = ownership.client === GENERIC_CLIENT ? undefined : ownership.client ?? undefined;
    const generic = ownership.client === GENERIC_CLIENT;
    return {
      type: seat.platform === 'MICROSOFT' ? 'export_microsoft' : 'import_google',
      email,
      uid: seat.uid,
      workspaceId: seat.workspaceId,
      workspaceName: seat.workspaceName,
      domain: seat.domain,
      platform: seat.platform,
      smartleadClientId: namedId,
      ledgerClient: ownership.client ?? undefined,
      genericDedicated: ownership.genericDedicated,
      slTags: generic ? [GENERIC_SMARTLEAD_TAG] : undefined,
      clientName: namedId != null ? clientNameFor(namedId) : undefined,
      firstName: seat.firstName,
      lastName: seat.lastName,
      reason: generic
        ? 'ACTIVE free-pool generic — import with client_id null + GENERIC tag'
        : ownership.genericDedicated
          ? `ACTIVE dedicated generic — import tagged to client ${namedId}`
          : seat.platform === 'MICROSOFT'
            ? 'ACTIVE in InboxKit, missing from Smartlead — InboxKit export'
            : 'ACTIVE in InboxKit, missing from Smartlead — Smartlead API import',
    };
  };

  for (const seat of input.seats) {
    const email = normalizeEmail(seat.email);
    const matches = (email ? slByEmail.get(email) : undefined) ?? [];
    const mixedWorkspace = mixed.has(seat.workspaceId) || workspaceMentionsDwGeneric(seat.workspaceName);
    const mappedClient = mixedWorkspace ? undefined : input.workspaceClientId.get(seat.workspaceId);
    const existing = ledger.get(email);
    const ownership = resolveSeatOwnership({
      seat,
      matches,
      mappedClient,
      mixedWorkspace,
      existing,
      powerGrydDomains,
    });

    if (ownership.powergryd || isPowerGrydSeat(seat, matches)) {
      skipped.push({
        reason: `PowerGRYD (${POWERGRYD_SMARTLEAD_CLIENT_ID}) — do not touch`,
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
      });
      continue;
    }

    const namedClientId =
      ownership.client !== GENERIC_CLIENT && ownership.client != null ? ownership.client : mappedClient;

    if (seat.lifecycle === 'scheduled_for_cancellation') {
      actions.push({
        type: 'log_cancellation',
        email,
        uid: seat.uid,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
        smartleadClientId: typeof namedClientId === 'number' ? namedClientId : undefined,
        ledgerClient: ownership.client ?? undefined,
        reason: 'scheduled_for_cancellation — leave in place until it takes effect',
        logState: 'upcoming',
        cancelDate: seat.cancelDate,
      });
      skipped.push({
        reason: 'scheduled_for_cancellation left alone',
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
      });
      continue;
    }

    if (seat.lifecycle === 'cancelled') {
      actions.push({
        type: 'log_cancellation',
        email,
        uid: seat.uid,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
        smartleadClientId: typeof namedClientId === 'number' ? namedClientId : undefined,
        ledgerClient: ownership.client ?? undefined,
        reason: 'Lapsed — Deliverability removes campaigns + Smartlead first',
        logState: 'due',
        cancelDate: seat.cancelDate,
      });
      if (matches.length > 0) {
        for (const account of matches) {
          if (campaignLinkBlocksSlDelete(account.id, campaignLinks)) {
            needsDecision.push({
              reason:
                'Lapsed but still campaign-linked (or link unknown) — Deliverability must remove from campaigns + Smartlead; sweep will not SL-delete',
              email,
              workspaceId: seat.workspaceId,
              workspaceName: seat.workspaceName,
              domain: seat.domain,
            });
          }
        }
        skipped.push({
          reason: 'Lapsed — waiting for Deliverability to remove from Smartlead before IK delete',
          email,
          workspaceId: seat.workspaceId,
          workspaceName: seat.workspaceName,
        });
        continue;
      }
      actions.push({
        type: 'delete_ik',
        email,
        uid: seat.uid,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
        ledgerClient: ownership.client ?? undefined,
        reason: 'Lapsed and gone from Smartlead — delete InboxKit seat',
        logState: 'deleted_IK',
      });
      continue;
    }

    if (seat.lifecycle !== 'active') {
      skipped.push({
        reason: `lifecycle ${seat.lifecycle} — chase later, do not import or cancel`,
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
      });
      continue;
    }

    if (blocked.has(email)) {
      needsDecision.push({
        reason: 'Pending Smartlead load approval on an onboarding job',
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
      });
      continue;
    }

    if (matches.length > 1) {
      needsDecision.push({
        reason: `Duplicate Smartlead accounts (${matches.length})`,
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
      });
    }

    if (matches.length === 0) {
      if (!ownership.known || ownership.client == null) {
        needsDecision.push({
          reason: mixedWorkspace
            ? 'MIXED workspace (DW Generic) — unknown ownership; do not import without a named client or generic'
            : 'Unmapped InboxKit workspace — unknown ownership; do not import without a named client or generic',
          email,
          workspaceId: seat.workspaceId,
          workspaceName: seat.workspaceName,
          domain: seat.domain,
        });
        continue;
      }
      actions.push(importAction(seat, email, ownership));
      continue;
    }

    const primary = matches[0]!;
    const genericLedger = ownership.client === GENERIC_CLIENT;
    if (genericLedger) {
      // Deliverability sets/clears client_id on free-pool generics — never overwrite.
    } else if (primary.clientId != null) {
      if (mappedClient != null && primary.clientId !== mappedClient) {
        needsDecision.push({
          reason: `Already tagged Smartlead client ${primary.clientId} — will not re-tag to ${mappedClient}`,
          email,
          workspaceId: seat.workspaceId,
          workspaceName: seat.workspaceName,
          domain: seat.domain,
        });
      }
    } else if (mappedClient != null && !mixedWorkspace && ownership.client !== GENERIC_CLIENT) {
      actions.push({
        type: 'tag_client',
        email,
        uid: seat.uid,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
        smartleadAccountId: primary.id,
        smartleadClientId: mappedClient,
        ledgerClient: ownership.client ?? undefined,
        genericDedicated: ownership.genericDedicated,
        clientName: clientNameFor(mappedClient),
        firstName: seat.firstName,
        lastName: seat.lastName,
        reason: `Untagged Smartlead account → ${mappedClient}`,
      });
    } else if (!genericLedger) {
      needsDecision.push({
        reason: mixedWorkspace
          ? 'In Smartlead but untagged; MIXED workspace (DW Generic) — do not bulk-tag'
          : 'In Smartlead but untagged; workspace has no client map',
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
      });
    }
    const sameMappedClient = mappedClient != null && primary.clientId === mappedClient;
    const justTagged =
      primary.clientId == null &&
      mappedClient != null &&
      !mixedWorkspace &&
      !genericLedger;
    if (!primary.warmupEnabled && (sameMappedClient || justTagged || genericLedger)) {
      actions.push({
        type: 'enable_warmup',
        email,
        uid: seat.uid,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        smartleadAccountId: primary.id,
        reason: 'Smartlead warmup off — enable',
      });
    }
  }

  const byDomain = new Map<string, IkSeat[]>();
  for (const seat of input.seats) {
    const domain = seat.domain.toLowerCase();
    if (!domain) continue;
    const list = byDomain.get(domain) ?? [];
    list.push(seat);
    byDomain.set(domain, list);
  }
  for (const [domain, list] of byDomain) {
    if (!list.length) continue;
    const allCancelled = list.every((s) => s.lifecycle === 'cancelled');
    if (!allCancelled) continue;
    const stillInSmartlead = list.some((s) => slByEmail.has(normalizeEmail(s.email)));
    if (stillInSmartlead) continue;
    const touchesPowerGryd = list.some((s) =>
      isPowerGrydSeat(s, slByEmail.get(normalizeEmail(s.email)) ?? []),
    );
    if (touchesPowerGryd) continue;
    actions.push({
      type: 'porkbun_autorenew_off',
      domain,
      reason: `Every seat on ${domain} is cancelled and gone from Smartlead`,
    });
  }

  return { actions, needsDecision, skipped };
}

export function workspaceMentionsDwGeneric(name?: string): boolean {
  return String(name || '')
    .trim()
    .toLowerCase()
    .includes(DW_GENERIC_WORKSPACE_NAME.toLowerCase());
}
