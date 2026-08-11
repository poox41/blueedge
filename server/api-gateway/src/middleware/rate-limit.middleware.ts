import type { RequestHandler } from "express";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  code: string;
  message: string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const maxTrackedClients = 10_000;

export function createRateLimitMiddleware(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>();

  return (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= maxTrackedClients) {
        for (const [client, candidate] of buckets) {
          if (candidate.resetAt <= now) buckets.delete(client);
        }
      }
      if (buckets.size >= maxTrackedClients && !buckets.has(key)) {
        res.setHeader("Retry-After", String(Math.ceil(options.windowMs / 1000)));
        res.status(429).json({ code: options.code, message: options.message });
        return;
      }
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(options.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ code: options.code, message: options.message });
      return;
    }

    next();
  };
}
