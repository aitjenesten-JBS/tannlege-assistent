import Anthropic from "@anthropic-ai/sdk";
import klinikk from "@/data/klinikk.json";
import { formaterTidspunkt, naaOslo } from "@/lib/kalender";
import { registrerForbruk, sjekkBudsjett } from "@/lib/kostnad";
import { hentLager } from "@/lib/lagring";
import { SYSTEMPROMPT } from "@/lib/systemprompt";
import { kjorTool, tools, type Tidsvelger } from "@/lib/tools";

export const MODELL = "claude-sonnet-5-5";
const MAKS_RUNDER = 8;
const MAKS_BRUKERMELDINGER = 30;
const SAMTALE_TTL_SEK = 24 * 3600;

const AVSLAG = `Det kan jeg dessverre ikke hjelpe med her. Ring klinikken på ${klinikk.telefon} (man–fre 08–16).`;
const TEKNISK_FEIL = `Beklager, noe gikk galt. Prøv igjen, eller ring klinikken på ${klinikk.telefon}.`;

type Melding = Anthropic.Beta.BetaMessageParam;

export interface ToolKall {
  navn: string;
  input: Record<string, unknown>;
  resultat: string;
  feil: boolean;
}

export interface Svar {
  tekst: string;
  toolKall: ToolKall[];
  stopp: string;
  tidsvelger?: Tidsvelger;
  kostnadUsd: number;
  tokens: { input: number; cacheSkriv: number; cacheLes: number; output: number };
}

let klient: Anthropic | undefined;
const hentKlient = () => (klient ??= new Anthropic());

function tidskontekst(naa: Date): string {
  const { dato, minutter } = naaOslo(naa);
  const hh = String(Math.floor(minutter / 60)).padStart(2, "0");
  const mm = String(minutter % 60).padStart(2, "0");
  const lesbar = formaterTidspunkt(`${dato}T${hh}:${mm}`);
  const ukedag = new Date(`${dato}T00:00:00Z`).getUTCDay();
  const apen = ukedag >= 1 && ukedag <= 5 && minutter >= 8 * 60 && minutter < 16 * 60;
  return `Nå er det ${lesbar} (Oslo-tid, dato ${dato}). Klinikken er ${apen ? "åpen" : "stengt"} akkurat nå.`;
}

const erBrukertekst = (m: Melding) =>
  m.role === "user" && (typeof m.content === "string" || m.content.some((b) => b.type === "text"));

/**
 * Ett brukerinnlegg inn, ett svar ut. Samtalen lagres på serveren og bare legges til på
 * (append-only): thinking-blokkene fra Sonnet 5.5 er bundet til uendret historikk, og
 * klienten kan ikke sende inn en forfalsket assistent-historikk.
 *
 * `hendelse` er serverbekreftet informasjon (f.eks. en booking gjort i skjemaet) som legges
 * i system-meldingen, så modellen kan stole på den og brukeren ikke kan forfalske den.
 */
export async function svar(samtaleId: string, brukertekst: string, naa = new Date(), hendelse?: string): Promise<Svar> {
  const lager = hentLager();
  const nokkel = `samtale:${samtaleId}`;
  const historikk = (await lager.hent<Melding[]>(nokkel)) ?? [];
  const toolKall: ToolKall[] = [];
  let tidsvelger: Tidsvelger | undefined;
  let kostnadUsd = 0;
  const tokens = { input: 0, cacheSkriv: 0, cacheLes: 0, output: 0 };
  const tekster: string[] = [];

  if (historikk.filter(erBrukertekst).length >= MAKS_BRUKERMELDINGER) {
    return { tekst: `Samtalen er blitt lang. Start en ny samtale, eller ring klinikken på ${klinikk.telefon}.`, toolKall, stopp: "maks_lengde", kostnadUsd, tokens };
  }

  // Kaster BudsjettOppbrukt før vi bruker penger. Ruten gjør det om til en vennlig melding.
  await sjekkBudsjett();

  // Tiden kommer som en system-melding (operatørkanal), ikke i brukerteksten, så den ikke kan forfalskes.
  const nye: Melding[] = [
    { role: "user", content: brukertekst },
    { role: "system", content: hendelse ? `${tidskontekst(naa)}

${hendelse}` : tidskontekst(naa) },
  ];

  for (let runde = 0; runde < MAKS_RUNDER; runde++) {
    const respons = await hentKlient().beta.messages.create({
      model: MODELL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
      // Bruddpunkt 1: verktøy + systemprompt er like i alle samtaler og caches på tvers av dem.
      // Bruddpunkt 2 (automatisk, toppnivå): samtalen så langt, for neste runde i samme samtale.
      system: [{ type: "text", text: SYSTEMPROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      messages: [...historikk, ...nye],
    });
    kostnadUsd += await registrerForbruk(respons.usage);
    tokens.input += respons.usage.input_tokens;
    tokens.cacheSkriv += respons.usage.cache_creation_input_tokens ?? 0;
    tokens.cacheLes += respons.usage.cache_read_input_tokens ?? 0;
    tokens.output += respons.usage.output_tokens;

    // Avslag lagres ikke, så historikken forblir gyldig for neste melding.
    if (respons.stop_reason === "refusal") return { tekst: AVSLAG, toolKall, stopp: "refusal", kostnadUsd, tokens };

    nye.push({ role: "assistant", content: respons.content });
    // Tekst fra alle runder i løkken: modellen skriver ofte det viktigste (helsesetning,
    // henvisning) før verktøykallet og bare en kort avslutning etter.
    for (const b of respons.content) if (b.type === "text" && b.text.trim()) tekster.push(b.text.trim());

    if (respons.stop_reason === "tool_use") {
      const resultater: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      // Sekvensielt, så to bookinger i samme runde ikke kolliderer.
      for (const blokk of respons.content) {
        if (blokk.type !== "tool_use") continue;
        const input = (blokk.input ?? {}) as Record<string, unknown>;
        const r = await kjorTool(blokk.name, input, naa);
        toolKall.push({ navn: blokk.name, input, resultat: r.innhold, feil: r.feil });
        if (r.tidsvelger) tidsvelger = r.tidsvelger;
        resultater.push({ type: "tool_result", tool_use_id: blokk.id, content: r.innhold, is_error: r.feil });
      }
      nye.push({ role: "user", content: resultater });
      continue;
    }

    const tekst = tekster.join("\n\n");
    await lager.lagre(nokkel, [...historikk, ...nye], SAMTALE_TTL_SEK);
    return { tekst: tekst || TEKNISK_FEIL, toolKall, stopp: respons.stop_reason ?? "ukjent", tidsvelger, kostnadUsd, tokens };
  }

  return { tekst: TEKNISK_FEIL, toolKall, stopp: "maks_runder", kostnadUsd, tokens };
}
