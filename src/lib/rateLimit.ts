interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

function getMaxAttempts(): number {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? "10");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
}

function getWindowMs(): number {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? "60000");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60_000;
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "local";
}

export function checkLoginRateLimit(
  key: string,
  now = Date.now()
): { allowed: boolean; retryAfterSec: number } {
  const maxAttempts = getMaxAttempts();
  const windowMs = getWindowMs();

  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (existing.count >= maxAttempts) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export function resetRateLimiter(): void {
  buckets.clear();
}
