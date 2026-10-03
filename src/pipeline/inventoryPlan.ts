import {
  DW_GENERIC_WORKSPACE_NAME,
  isPowerGrydClientId,
  POWERGRYD_SMARTLEAD_CLIENT_ID,
} from '../lib/standards.js';

export type IkLifecycle = 'active' | 'cancelled' | 'scheduled_for_cancellation' | 'other';

export type Platform = 'GOOGLE' | 'MICROSOFT';

export interface IkSeat {
  uid: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  domain: string;
  platform: Platform;
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

export function planInventoryActions(input: {
  seats: IkSeat[];
  slAccounts: SlAccount[];
  workspaceClientId: Map<string, number>;
  /** Emails blocked by a pending per-job Smartlead load approval. */
  blockedEmails?: Set<string>;
}): {
  actions: SweepAction[];
  needsDecision: SweepDecision[];
  skipped: SweepSkip[];
} {
  const actions: SweepAction[] = [];
  const needsDecision: SweepDecision[] = [];
  const skipped: SweepSkip[] = [];
  const blocked = input.blockedEmails ?? new Set<string>();

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

  for (const seat of input.seats) {
    const email = normalizeEmail(seat.email);
    const matches = (email ? slByEmail.get(email) : undefined) ?? [];
    const touchesPowerGryd = matches.some((a) => isPowerGrydClientId(a.clientId));
    if (powerGrydWorkspaces.has(seat.workspaceId) || touchesPowerGryd) {
      skipped.push({
        reason: `PowerGRYD (${POWERGRYD_SMARTLEAD_CLIENT_ID}) — do not touch`,
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
      });
      continue;
    }

    const mappedClient = input.workspaceClientId.get(seat.workspaceId);
    if (mappedClient != null && isPowerGrydClientId(mappedClient)) {
      skipped.push({
        reason: `PowerGRYD (${POWERGRYD_SMARTLEAD_CLIENT_ID}) — do not touch`,
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
      });
      continue;
    }

    if (seat.lifecycle === 'scheduled_for_cancellation') {
      actions.push({
        type: 'log_cancellation',
        email,
        uid: seat.uid,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
        smartleadClientId: mappedClient,
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
        smartleadClientId: mappedClient,
        reason: 'CANCELLED in InboxKit — standing sweep delete',
        logState: 'due',
        cancelDate: seat.cancelDate,
      });
      actions.push({
        type: 'delete_ik',
        email,
        uid: seat.uid,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
        reason: 'CANCELLED — delete InboxKit seat',
        logState: 'deleted_IK',
      });
      for (const account of matches) {
        actions.push({
          type: 'delete_sl',
          email,
          uid: seat.uid,
          workspaceId: seat.workspaceId,
          workspaceName: seat.workspaceName,
          domain: seat.domain,
          smartleadAccountId: account.id,
          smartleadClientId: account.clientId,
          reason: 'CANCELLED — remove from Smartlead',
          logState: 'deleted_SL',
        });
      }
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
      if (seat.platform === 'MICROSOFT') {
        actions.push({
          type: 'export_microsoft',
          email,
          uid: seat.uid,
          workspaceId: seat.workspaceId,
          workspaceName: seat.workspaceName,
          domain: seat.domain,
          platform: 'MICROSOFT',
          smartleadClientId: mappedClient,
          firstName: seat.firstName,
          lastName: seat.lastName,
          reason: 'ACTIVE in InboxKit, missing from Smartlead — InboxKit export',
        });
      } else {
        actions.push({
          type: 'import_google',
          email,
          uid: seat.uid,
          workspaceId: seat.workspaceId,
          workspaceName: seat.workspaceName,
          domain: seat.domain,
          platform: 'GOOGLE',
          smartleadClientId: mappedClient,
          firstName: seat.firstName,
          lastName: seat.lastName,
          reason: 'ACTIVE in InboxKit, missing from Smartlead — Smartlead API import',
        });
      }
      if (mappedClient == null) {
        needsDecision.push({
          reason: 'No InboxKit workspace → Smartlead client map (imported untagged if live)',
          email,
          workspaceId: seat.workspaceId,
          workspaceName: seat.workspaceName,
          domain: seat.domain,
        });
      }
      continue;
    }

    const primary = matches[0]!;
    if (mappedClient != null && primary.clientId !== mappedClient) {
      actions.push({
        type: 'tag_client',
        email,
        uid: seat.uid,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
        smartleadAccountId: primary.id,
        smartleadClientId: mappedClient,
        firstName: seat.firstName,
        lastName: seat.lastName,
        reason: `Smartlead client ${primary.clientId ?? 'none'} → ${mappedClient}`,
      });
    } else if (mappedClient == null && primary.clientId == null) {
      needsDecision.push({
        reason: 'In Smartlead but untagged; workspace has no client map',
        email,
        workspaceId: seat.workspaceId,
        workspaceName: seat.workspaceName,
        domain: seat.domain,
      });
    }
    if (!primary.warmupEnabled) {
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
    const touchesPowerGryd = list.some((s) => {
      const matches = slByEmail.get(normalizeEmail(s.email)) ?? [];
      return (
        powerGrydWorkspaces.has(s.workspaceId) ||
        matches.some((a) => isPowerGrydClientId(a.clientId))
      );
    });
    if (touchesPowerGryd) continue;
    actions.push({
      type: 'porkbun_autorenew_off',
      domain,
      reason: `Every seat on ${domain} is cancelled`,
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
