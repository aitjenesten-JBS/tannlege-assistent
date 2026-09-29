import type Anthropic from "@anthropic-ai/sdk";
import ansatte from "@/data/ansatte.json";
import {
  avbestillTime,
  bestillTime,
  bookbareBehandlinger,
  Brukerfeil,
  finnBooking,
  finnLedigeTider,
  flyttTime,
  overforTilKlinikken,
  sjekkBehandling,
} from "@/lib/kalender";
import { sendBekreftelse } from "@/lib/epost";

const behandlingIder = bookbareBehandlinger().map((b) => b.id);
const behandlerIder = ansatte.filter((a) => a.bookbar).map((a) => a.id);

const tekst = (description: string) => ({ type: "string", description }) as const;
const tidspunkt = tekst("Starttid som ÅÅÅÅ-MM-DDTHH:MM (Oslo-tid), nøyaktig som returnert fra finn_ledige_tider.");
const bookingkode = tekst("Bookingkoden pasienten fikk, f.eks. TTK-AB12C.");
const telefon = tekst("Pasientens telefonnummer, 8 siffer.");

// Rekkefølgen og innholdet her må være stabilt mellom kall (prompt-cache og preserved thinking).
export const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "finn_ledige_tider",
    description:
      "Finn opptil 5 ledige timer for en behandling, med riktig varighet og behandler. Bruk før du foreslår tider. Foreslå kun tider som dette verktøyet har returnert.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        behandling: { type: "string", enum: behandlingIder, description: "Behandlingstype." },
        fra_dato: tekst("Tidligste dato som ÅÅÅÅ-MM-DD. Utelat for tidligst mulig."),
        behandler: { type: "string", enum: behandlerIder, description: "Kun hvis pasienten ønsker en bestemt behandler." },
      },
      required: ["behandling"],
      additionalProperties: false,
    },
  },
  {
    name: "bestill_time",
    description:
      "Bestill en time. Kall kun etter at pasienten har valgt en konkret tid fra finn_ledige_tider og oppgitt navn, telefon og e-post.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        behandling: { type: "string", enum: behandlingIder },
        tidspunkt,
        behandler: { type: "string", enum: behandlerIder, description: "behandler_id fra den valgte ledige tiden." },
        navn: tekst("Pasientens fulle navn."),
        telefon,
        epost: tekst("Pasientens e-postadresse."),
        kommentar: tekst("Valgfri praktisk kommentar til klinikken (maks 200 tegn). Aldri helseopplysninger."),
      },
      required: ["behandling", "tidspunkt", "behandler", "navn", "telefon", "epost"],
      additionalProperties: false,
    },
  },
  {
    name: "finn_booking",
    description: "Slå opp en eksisterende time med bookingkode og telefonnummer.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { bookingkode, telefon },
      required: ["bookingkode", "telefon"],
      additionalProperties: false,
    },
  },
  {
    name: "flytt_time",
    description:
      "Flytt en eksisterende time til et nytt tidspunkt. Finn ledige tider for samme behandling først, og la pasienten velge.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        bookingkode,
        telefon,
        nytt_tidspunkt: tidspunkt,
        behandler: { type: "string", enum: behandlerIder, description: "Kun hvis den nye tiden er hos en annen behandler." },
      },
      required: ["bookingkode", "telefon", "nytt_tidspunkt"],
      additionalProperties: false,
    },
  },
  {
    name: "avbestill_time",
    description: "Avbestill en time. Bekreft med pasienten hvilken time det gjelder før du kaller.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { bookingkode, telefon },
      required: ["bookingkode", "telefon"],
      additionalProperties: false,
    },
  },
  {
    name: "vis_tidsvelger",
    description:
      "Vis en kalender i chatten der pasienten selv velger dag og tid. Førstevalget når pasienten vil bestille eller flytte en time og behandlingen er kjent. Ved ny time fyller pasienten inn navn, telefon og e-post i et skjema i kalenderen.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        formaal: { type: "string", enum: ["ny_time", "flytte"], description: "ny_time for ny bestilling, flytte for å flytte en eksisterende time." },
        behandling: { type: "string", enum: behandlingIder, description: "Behandlingstype. Ved flytting: samme behandling som timen som flyttes." },
        behandler: { type: "string", enum: behandlerIder, description: "Kun hvis pasienten ønsker en bestemt behandler." },
        fra_dato: tekst("Dato kalenderen skal åpne på, som ÅÅÅÅ-MM-DD. Utelat for tidligst mulig."),
      },
      required: ["formaal", "behandling"],
      additionalProperties: false,
    },
  },
  {
    name: "overfor_til_klinikken",
    description:
      "Send en henvendelse til klinikkens personale når du ikke kan hjelpe (f.eks. faktura, journal, klager, spørsmål som ikke står i informasjonen din). Be om kontaktinfo først.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        oppsummering: tekst("Kort, nøytral oppsummering av hva pasienten trenger hjelp med. Ingen helseopplysninger."),
        kontaktinfo: tekst("Navn og telefon eller e-post pasienten vil bli kontaktet på."),
      },
      required: ["oppsummering", "kontaktinfo"],
      additionalProperties: false,
    },
  },
];

type Input = Record<string, unknown>;
const str = (input: Input, felt: string) => {
  const v = input[felt];
  return typeof v === "string" ? v : "";
};
const valgfri = (input: Input, felt: string) => (typeof input[felt] === "string" && input[felt] ? (input[felt] as string) : undefined);

export interface Tidsvelger {
  formaal: "ny_time" | "flytte";
  behandling: string;
  behandling_navn: string;
  varighet_min: number;
  behandler?: string;
  fra_dato?: string;
}

export async function kjorTool(
  navn: string,
  input: Input,
  naa = new Date(),
): Promise<{ innhold: string; feil: boolean; tidsvelger?: Tidsvelger }> {
  try {
    let resultat: unknown;
    switch (navn) {
      case "vis_tidsvelger": {
        const formaal = input.formaal === "flytte" ? "flytte" : "ny_time";
        const behandler = valgfri(input, "behandler");
        const fraDato = valgfri(input, "fra_dato");
        const tidsvelger: Tidsvelger = { formaal, ...sjekkBehandling(str(input, "behandling"), behandler), behandler, fra_dato: fraDato };
        const neste =
          formaal === "ny_time"
            ? "Pasienten velger tid og fyller inn navn, telefon og e-post i skjemaet. Ikke be om kontaktinfo i chatten. Når bookingen er gjort, får du beskjed i en system-melding."
            : "Når pasienten har valgt, kommer valget som en melding. Kall da flytt_time med bookingkoden og telefonnummeret du allerede har.";
        return {
          innhold: `Kalenderen vises nå under svaret ditt. Skriv svaret til pasienten nå. Har du ikke allerede skrevet det i en tekstmelding, ta med det reglene krever (f.eks. helsesetningen og henvisning til klinikken ved plager, og hva du setter opp med varighet og pris), og si i én setning at pasienten kan velge dag og tid i kalenderen. Ikke gjenta tekst du allerede har skrevet, og ikke list opp tider selv. ${neste}`,
          feil: false,
          tidsvelger,
        };
      }
      case "finn_ledige_tider":
        resultat = await finnLedigeTider(
          { behandling: str(input, "behandling"), fra_dato: valgfri(input, "fra_dato"), behandler: valgfri(input, "behandler") },
          naa,
        );
        break;
      case "bestill_time": {
        const booking = await bestillTime(
          {
            behandling: str(input, "behandling"),
            tidspunkt: str(input, "tidspunkt"),
            behandler: str(input, "behandler"),
            navn: str(input, "navn"),
            telefon: str(input, "telefon"),
            epost: str(input, "epost"),
            kommentar: valgfri(input, "kommentar"),
          },
          naa,
        );
        const epost = await sendBekreftelse(booking, str(input, "epost"));
        resultat = { ...booking, epost: epost === "sendt" ? "bekreftelse sendt på e-post" : "e-post ikke sendt (demo)" };
        break;
      }
      case "finn_booking":
        resultat = await finnBooking({ bookingkode: str(input, "bookingkode"), telefon: str(input, "telefon") });
        break;
      case "flytt_time":
        resultat = await flyttTime(
          {
            bookingkode: str(input, "bookingkode"),
            telefon: str(input, "telefon"),
            nytt_tidspunkt: str(input, "nytt_tidspunkt"),
            behandler: valgfri(input, "behandler"),
          },
          naa,
        );
        break;
      case "avbestill_time":
        resultat = await avbestillTime({ bookingkode: str(input, "bookingkode"), telefon: str(input, "telefon") });
        break;
      case "overfor_til_klinikken":
        resultat = await overforTilKlinikken({ oppsummering: str(input, "oppsummering"), kontaktinfo: str(input, "kontaktinfo") }, naa);
        break;
      default:
        return { innhold: `Ukjent verktøy «${navn}». Gyldige: ${tools.map((t) => t.name).join(", ")}.`, feil: true };
    }
    return { innhold: JSON.stringify(resultat), feil: false };
  } catch (e) {
    if (e instanceof Brukerfeil) return { innhold: e.message, feil: true };
    console.error(`Tool ${navn} feilet`, e);
    return { innhold: "Teknisk feil i timeboken. Be pasienten ringe klinikken.", feil: true };
  }
}
