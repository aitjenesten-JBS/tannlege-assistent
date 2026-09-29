import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import klinikk from "@/data/klinikk.json";
import { harRedis } from "@/lib/lagring";

// Felles for API-rutene: feilsvar, validering og rate limit.
// Rate limit krever Upstash. Lokalt uten nøkler er den av.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const feil = (status: number, melding: string) => Response.json({ feil: melding }, { status });

const lagGrenser = () => {
  const redis = Redis.fromEnv();
  return {
    // Meldinger til modellen koster penger: stram grense per IP og et totalt døgntak.
    chat: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, "1 h"), prefix: "rl:chat" }),
    totalt: new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(150, "1 d"), prefix: "rl:totalt" }),
    // Kalenderoppslag og skjemaet er billige, men skal ikke kunne hamres løs på.
    kalender: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, "1 h"), prefix: "rl:kalender" }),
  };
};
let grenser: ReturnType<typeof lagGrenser> | null | undefined;

export async function sjekkGrense(request: Request, type: "chat" | "kalender"): Promise<Response | null> {
  if (grenser === undefined) grenser = harRedis() ? lagGrenser() : null;
  if (!grenser) return null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "ukjent";
  const resultater = await Promise.all(
    type === "chat" ? [grenser.chat.limit(ip), grenser.totalt.limit("alle")] : [grenser.kalender.limit(ip)],
  );
  if (resultater.every((r) => r.success)) return null;
  return feil(429, `Du har sendt mange forespørsler. Prøv igjen senere, eller ring klinikken på ${klinikk.telefon}.`);
}

export async function lesJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
