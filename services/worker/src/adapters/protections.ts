/** Detect retailer protections from an HTTP status and page body (DROP-91). */
export function detectProtections(status: number, body = ''): string[] {
  const found = new Set<string>();
  if (status === 429) found.add('ratelimit');
  const b = body.slice(0, 300_000);
  if (/queue-it|waiting\s?room|you are now in line|you're in line|virtual queue/i.test(b))
    found.add('queue');
  if (
    /captcha|px-captcha|cf-chl|challenge-platform|are you a (robot|human)|verify you are human/i.test(
      b,
    )
  )
    found.add('captcha');
  if (status === 403 && !found.has('captcha')) found.add('blocked');
  if (/sign in to add to cart|log in to purchase|members?\s+only/i.test(b))
    found.add('signin_required');
  const limit = /limit\s+(\d+)\s+per\s+(customer|order|guest|household)/i.exec(b);
  if (limit) found.add(`limit:${limit[1]}`);
  if (/available only (in|on) the app|app exclusive|only in the \w+ app/i.test(b))
    found.add('app_only');
  if (/in-store only|not available online|online purchase unavailable/i.test(b))
    found.add('in_store_only');
  if (/enter the (drawing|raffle)|randomly selected|raffle entry/i.test(b)) found.add('raffle');
  return [...found];
}

/** Protections that mean a person has to act; the bot never tries to get past these. */
export const HUMAN_REQUIRED = new Set(['queue', 'captcha', 'signin_required', 'blocked']);

export class BlockedError extends Error {
  constructor(
    public status: number,
    public protections: string[],
  ) {
    super(`Blocked (${status}): ${protections.join(', ') || 'unknown'}`);
  }
}
