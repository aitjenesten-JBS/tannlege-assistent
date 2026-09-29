import ansatte from "@/data/ansatte.json";
import behandlinger from "@/data/behandlinger.json";
import klinikk from "@/data/klinikk.json";
import { osloTilUtc } from "@/lib/ics";
import type { Booking } from "@/lib/kalender";
import { hentLager } from "@/lib/lagring";

// Integrasjon mot klinikkens eget system. Hver hendelse på en bestilling sendes som en
// FHIR R4 Appointment til BOOKING_WEBHOOK_URL, og alt logges så sekretæren (og en demo)
// kan se nøyaktig hva som ble sendt. Norske journalsystemer (f.eks. Opus Dental) har ikke
// åpne API-er, så i ekte drift ville webhooken gått til en integrasjon avtalt med leverandøren.
// Merk: payloaden inneholder personopplysninger (navn, telefon, e-post). Bruk bare demo-data
// mot tredjeparts testmottakere som webhook.site.

export type Hendelse = "opprettet" | "flyttet" | "avbestilt" | "bekreftet" | "avvist";
export type Gjennomgang = "ny" | "bekreftet" | "avvist";

export interface LoggRad {
  id: string;
  tid: string;
  hendelse: Hendelse;
  kode: string;
  status: "sendt" | "feilet" | "ikke_konfigurert";
  http?: number;
  feil?: string;
  mottaker?: string;
  payload: unknown;
}

const LOGG = "integrasjonslogg";
const MAKS_LOGG = 200;

const FHIR_STATUS: Record<Hendelse, string> = {
  opprettet: "pending", // reservert, venter på klinikkens gjennomgang
  flyttet: "pending",
  bekreftet: "booked",
  avvist: "cancelled",
  avbestilt: "cancelled",
};

/** FHIR R4 Appointment for én bestilling. Pasienten ligger som «contained» Patient. */
export function tilFhirAppointment(b: Booking, hendelse: Hendelse) {
  const start = osloTilUtc(b.tidspunkt);
  const slutt = new Date(start.getTime() + b.varighet_min * 60_000);
  const behandling = behandlinger.find((x) => x.id === b.behandling_id);
  const behandler = ansatte.find((a) => a.id === b.behandler_id);
  const [fornavn, ...etternavn] = b.navn.split(" ");
  return {
    resourceType: "Appointment",
    id: b.kode,
    identifier: [{ system: "urn:torget:bookingkode", value: b.kode }],
    status: FHIR_STATUS[hendelse],
    ...(hendelse === "avvist" || hendelse === "avbestilt"
      ? { cancelationReason: { text: hendelse === "avvist" ? "Avvist av klinikken" : "Avbestilt av pasienten" } }
      : {}),
    serviceType: [{ coding: [{ system: "urn:torget:behandling", code: b.behandling_id }], text: behandling?.navn ?? b.behandling_id }],
    description: behandling?.navn,
    start: start.toISOString(),
    end: slutt.toISOString(),
    minutesDuration: b.varighet_min,
    created: b.opprettet,
    comment: b.kommentar,
    contained: [
      {
        resourceType: "Patient",
        id: "pasient",
        name: [{ text: b.navn, given: [fornavn], family: etternavn.join(" ") || undefined }],
        telecom: [
          { system: "phone", value: `+47${b.telefon}` },
          { system: "email", value: b.epost },
        ],
      },
    ],
    participant: [
      { actor: { reference: "#pasient", display: b.navn }, status: "accepted" },
      { actor: { display: behandler ? `${behandler.navn} (${behandler.rolle})` : b.behandler_id }, status: hendelse === "bekreftet" ? "accepted" : "needs-action" },
      { actor: { display: `${klinikk.navn}, ${klinikk.adresse.gate}, ${klinikk.adresse.sted}` }, status: "accepted" },
    ],
  };
}

/** Sender hendelsen til klinikksystemet og logger resultatet. Kaster aldri: bookingen skal ikke feile av dette. */
export async function varsleKlinikksystem(hendelse: Hendelse, booking: Booking, naa = new Date()): Promise<LoggRad> {
  const payload = { hendelse, kilde: "torget-digital-assistent", tidspunkt: naa.toISOString(), appointment: tilFhirAppointment(booking, hendelse) };
  const url = process.env.BOOKING_WEBHOOK_URL?.trim();
  const rad: LoggRad = { id: crypto.randomUUID(), tid: naa.toISOString(), hendelse, kode: booking.kode, status: "ikke_konfigurert", payload };

  if (url) {
    rad.mottaker = new URL(url).host;
    try {
      const svar = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/fhir+json", "x-kilde": "torget-digital-assistent", "x-hendelse": hendelse },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });
      rad.http = svar.status;
      rad.status = svar.ok ? "sendt" : "feilet";
    } catch (e) {
      rad.status = "feilet";
      rad.feil = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    const lager = hentLager();
    const logg = (await lager.hent<LoggRad[]>(LOGG)) ?? [];
    await lager.lagre(LOGG, [rad, ...logg].slice(0, MAKS_LOGG), 30 * 24 * 3600);
  } catch (e) {
    console.error("Kunne ikke logge integrasjon:", e);
  }
  return rad;
}

export async function hentIntegrasjonslogg(): Promise<LoggRad[]> {
  return (await hentLager().hent<LoggRad[]>(LOGG)) ?? [];
}
