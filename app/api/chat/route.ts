import Anthropic from "@anthropic-ai/sdk";
import klinikk from "@/data/klinikk.json";
import { feil, lesJson, sjekkGrense, UUID } from "@/lib/api";
import { svar } from "@/lib/assistent";
import { erFrakoblet, frakobletSvar } from "@/lib/frakoblet";
import { BudsjettOppbrukt } from "@/lib/kostnad";
import { harAiTilgang } from "@/lib/tilgang";

export const maxDuration = 60;

const MAKS_TEGN = 1000;

export async function POST(request: Request) {
  const body = await lesJson(request);
  if (!body) return feil(400, "Ugyldig forespørsel.");
  const { samtaleId, melding } = body;
  if (typeof samtaleId !== "string" || !UUID.test(samtaleId)) return feil(400, "Ugyldig samtale-id.");
  if (typeof melding !== "string" || !melding.trim()) return feil(400, "Meldingen er tom.");
  if (melding.length > MAKS_TEGN) return feil(400, `Meldingen er for lang (maks ${MAKS_TEGN} tegn).`);

  const begrenset = await sjekkGrense(request, "chat");
  if (begrenset) return begrenset;

  try {
    // Uten tilgangskode (eller i frakoblet modus): skriptet demo, bruker ikke API-kreditter.
    if (erFrakoblet() || !harAiTilgang(request)) {
      const res = await frakobletSvar(samtaleId, melding.trim());
      return Response.json({ svar: res.tekst, tidsvelger: res.tidsvelger ?? null, frakoblet: true });
    }
    const resultat = await svar(samtaleId, melding.trim());
    console.info(`chat: ${resultat.toolKall.map((k) => k.navn).join(",") || "ingen tools"}, ${resultat.kostnadUsd.toFixed(4)} USD`);
    return Response.json({ svar: resultat.tekst, tidsvelger: resultat.tidsvelger ?? null });
  } catch (e) {
    if (e instanceof BudsjettOppbrukt) {
      return feil(503, `Demoen har nådd kostnadstaket sitt for nå. Ring klinikken på ${klinikk.telefon}, eller prøv igjen i morgen.`);
    }
    if (e instanceof Anthropic.RateLimitError) {
      return feil(503, `Assistenten er travel akkurat nå. Prøv igjen om litt, eller ring klinikken på ${klinikk.telefon}.`);
    }
    if (e instanceof Anthropic.APIError) console.error(`Claude API ${e.status}:`, e.message);
    else console.error(e);
    return feil(500, `Beklager, noe gikk galt. Prøv igjen, eller ring klinikken på ${klinikk.telefon}.`);
  }
}
