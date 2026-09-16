import type { Request } from 'express';

export type RawBodyRequest = Request & { rawBody?: string };

/** Capture the exact bytes Express parsed — required for Slack signature checks. */
export function captureRawBody(req: Request, _res: unknown, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = buf.toString('utf8');
}
