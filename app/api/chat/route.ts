import Anthropic from "@anthropic-ai/sdk";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { svar } from "@/lib/assistent";
import { harRedis } from "@/lib/lagring";

export const maxDuration = 60;

const MAKS_TEGN = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate limit krever Upstash. Lokalt uten nøkler er den av.
const grenser = harRedis()
  ? {
      perIp: new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(20, "1 h"), prefix: "rl:ip" }),
      totalt: new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.fixedWindow(500, "1 d"), prefix: "rl:totalt" }),
    }
  : null;

const feil = (status: number, melding: string) => Response.json({ feil: melding }, { status });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return feil(400, "Ugyldig forespørsel.");
  }
  const { samtaleId, melding } = (body ?? {}) as { samtaleId?: unknown; melding?: unknown };
  if (typeof samtaleId !== "string" || !UUID.test(samtaleId)) return feil(400, "Ugyldig samtale-id.");
  if (typeof melding !== "string" || !melding.trim()) return feil(400, "Meldingen er tom.");
  if (melding.length > MAKS_TEGN) return feil(400, `Meldingen er for lang (maks ${MAKS_TEGN} tegn).`);

  if (grenser) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "ukjent";
    const [perIp, totalt] = await Promise.all([grenser.perIp.limit(ip), grenser.totalt.limit("alle")]);
    if (!perIp.success || !totalt.success) {
      return feil(429, "Du har sendt mange meldinger. Prøv igjen senere, eller ring klinikken på 12 34 56 78.");
    }
  }

  try {
    const resultat = await svar(samtaleId, melding.trim());
    return Response.json({ svar: resultat.tekst });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return feil(503, "Assistenten er travel akkurat nå. Prøv igjen om litt, eller ring klinikken på 12 34 56 78.");
    }
    if (e instanceof Anthropic.APIError) console.error(`Claude API ${e.status}:`, e.message);
    else console.error(e);
    return feil(500, "Beklager, noe gikk galt. Prøv igjen, eller ring klinikken på 12 34 56 78.");
  }
}
