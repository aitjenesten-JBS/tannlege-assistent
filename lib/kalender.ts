import klinikk from "@/data/klinikk.json";
import behandlinger from "@/data/behandlinger.json";
import ansatte from "@/data/ansatte.json";
import { type Gjennomgang, varsleKlinikksystem } from "@/lib/klinikksystem";
import { hentLager } from "@/lib/lagring";
import { HELSE_SVAR, inneholderHelseopplysninger } from "@/lib/helse";
import { MANEDER, UKEDAGER } from "@/lib/tidsformat";

// Simulert timebok. Alle tider er veggklokketid i Oslo, som strenger
// ("2026-09-30T09:15"), så serverens tidssone (UTC på Vercel) ikke spiller inn.

export class Brukerfeil extends Error {}

export type Behandling = (typeof behandlinger)[number];
export type Ansatt = (typeof ansatte)[number];

export interface Booking {
  kode: string;
  behandling_id: string;
  behandler_id: string;
  tidspunkt: string;
  varighet_min: number;
  navn: string;
  telefon: string;
  epost: string;
  kommentar?: string;
  opprettet: string;
  gjennomgang?: Gjennomgang; // mangler på eldre bookinger = "ny"
  behandlet?: string;
}

interface Opptatt {
  kode?: string;
  behandler_id: string;
  fra: number;
  til: number;
}

const APNER = 8 * 60;
const STENGER = 16 * 60;
const LUNSJ = { fra: 11 * 60 + 30, til: 12 * 60 };
const STEG = 15;
const MIN_VARSEL_MIN = 60; // tidligste time i dag: minst en time frem
const SOKEHORISONT_DAGER = 30;
const MAKS_FORSLAG = 5;
const BOOKING_TTL_SEK = 90 * 24 * 3600;
const MAKS_KOMMENTAR = 200;


// ---------- tid ----------

export function naaOslo(naa = new Date()): { dato: string; minutter: number } {
  const deler = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(naa)
      .map((d) => [d.type, d.value]),
  );
  return { dato: `${deler.year}-${deler.month}-${deler.day}`, minutter: Number(deler.hour) * 60 + Number(deler.minute) };
}

const tilUtc = (dato: string) => new Date(`${dato}T00:00:00Z`);

function leggTilDager(dato: string, dager: number): string {
  const d = tilUtc(dato);
  d.setUTCDate(d.getUTCDate() + dager);
  return d.toISOString().slice(0, 10);
}

const ukedag = (dato: string) => tilUtc(dato).getUTCDay();
const erArbeidsdag = (dato: string) => ukedag(dato) >= 1 && ukedag(dato) <= 5;
const klokke = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function gyldigDato(dato: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return false;
  const d = tilUtc(dato);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dato;
}

export function tolkTidspunkt(tidspunkt: string): { dato: string; min: number } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(tidspunkt?.trim() ?? "");
  if (!m || !gyldigDato(m[1])) throw new Brukerfeil(`Ugyldig tidspunkt «${tidspunkt}». Bruk formatet ÅÅÅÅ-MM-DDTHH:MM.`);
  return { dato: m[1], min: Number(m[2]) * 60 + Number(m[3]) };
}

export function formaterTidspunkt(tidspunkt: string): string {
  const { dato, min } = tolkTidspunkt(tidspunkt);
  const d = tilUtc(dato);
  return `${UKEDAGER[d.getUTCDay()]} ${d.getUTCDate()}. ${MANEDER[d.getUTCMonth()]} kl. ${klokke(min)}`;
}

// ---------- oppslag ----------

function hentBehandling(id: string): Behandling {
  const b = behandlinger.find((x) => x.id === id);
  if (!b) throw new Brukerfeil(`Ukjent behandling «${id}». Gyldige: ${bookbareBehandlinger().map((x) => x.id).join(", ")}.`);
  if (!b.bookbar_online || !b.varighet_min) {
    throw new Brukerfeil(`${b.navn} kan ikke bestilles på nett. ${b.merknad ?? "Ta kontakt med klinikken."}`);
  }
  return b;
}

export const bookbareBehandlinger = () => behandlinger.filter((b) => b.bookbar_online && b.varighet_min);

function aktuelleBehandlere(b: Behandling, behandlerId?: string): Ansatt[] {
  const kandidater = ansatte.filter((a) => a.bookbar && b.behandlertyper.includes(a.rolle));
  if (!behandlerId) return kandidater;
  const valgt = ansatte.find((a) => a.id === behandlerId);
  if (!valgt || !valgt.bookbar) {
    throw new Brukerfeil(`Ukjent behandler «${behandlerId}». Gyldige: ${ansatte.filter((a) => a.bookbar).map((a) => a.id).join(", ")}.`);
  }
  if (!kandidater.includes(valgt)) throw new Brukerfeil(`${valgt.navn} (${valgt.rolle}) utfører ikke ${b.navn.toLowerCase()}.`);
  return [valgt];
}

/** Validerer behandling og eventuell behandler, og gir det widgeten trenger for kalendervisningen. */
export function sjekkBehandling(behandlingId: string, behandlerId?: string) {
  const b = hentBehandling(behandlingId);
  aktuelleBehandlere(b, behandlerId);
  return { behandling: b.id, behandling_navn: b.navn, varighet_min: b.varighet_min! };
}

const behandlerNavn = (id: string) => ansatte.find((a) => a.id === id)?.navn ?? id;

// ---------- simulert belegg ----------

function frø(tekst: string): () => number {
  let h = 2166136261;
  for (const c of tekst) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    // mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlapper = (a: { fra: number; til: number }, b: { fra: number; til: number }) => a.fra < b.til && b.fra < a.til;

/** To akutt-tider per dag, fordelt på tannlegene. Kun akutt kan bestille dem. */
export function akuttTider(dato: string): Opptatt[] {
  const tannleger = ansatte.filter((a) => a.bookbar && a.rolle === "tannlege");
  const n = Math.floor(tilUtc(dato).getTime() / 86_400_000);
  return [
    { behandler_id: tannleger[n % tannleger.length].id, fra: 8 * 60 + 30, til: 9 * 60 },
    { behandler_id: tannleger[(n + 1) % tannleger.length].id, fra: 13 * 60, til: 13 * 60 + 30 },
  ];
}

/** Tilfeldige, men faste (seedede) opptatte tider, så kalenderen ser realistisk ut og evalen blir stabil. */
export function simulertBelegg(behandlerId: string, dato: string): Opptatt[] {
  const tilfeldig = frø(`${behandlerId}|${dato}`);
  const reservert = akuttTider(dato).filter((a) => a.behandler_id === behandlerId);
  const opptatt: Opptatt[] = [];
  let t = APNER;
  while (t < STENGER) {
    if (tilfeldig() < 0.3) {
      const lengde = [30, 45, 60][Math.floor(tilfeldig() * 3)];
      const blokk = { behandler_id: behandlerId, fra: t, til: t + lengde };
      if (blokk.til <= STENGER && !overlapper(blokk, LUNSJ) && !reservert.some((r) => overlapper(r, blokk))) {
        opptatt.push(blokk);
        t = blokk.til;
        continue;
      }
    }
    t += STEG;
  }
  return opptatt;
}

// ---------- lagring av bookinger ----------

const dagNokkel = (dato: string) => `dag:${dato}`;
const bookingNokkel = (kode: string) => `booking:${kode}`;

async function bookingerForDag(dato: string): Promise<Opptatt[]> {
  return (await hentLager().hent<Opptatt[]>(dagNokkel(dato))) ?? [];
}

/** Alt som er opptatt for én behandler en dag. Dagens bookinger hentes av kalleren, én gang per dag. */
function opptattFor(behandlingId: string, behandlerId: string, dato: string, dagensBookinger: Opptatt[], ignorerKode?: string): Opptatt[] {
  const bookinger = dagensBookinger.filter((b) => b.behandler_id === behandlerId && b.kode !== ignorerKode);
  const akutt = behandlingId === "akutt" ? [] : akuttTider(dato).filter((a) => a.behandler_id === behandlerId);
  return [...simulertBelegg(behandlerId, dato), ...bookinger, ...akutt];
}

function erLedig(dato: string, fra: number, varighet: number, opptatt: Opptatt[]) {
  const intervall = { fra, til: fra + varighet };
  if (!erArbeidsdag(dato) || fra < APNER || intervall.til > STENGER || overlapper(intervall, LUNSJ)) return false;
  return !opptatt.some((o) => overlapper(o, intervall));
}

async function erLedigNa(behandlingId: string, behandlerId: string, dato: string, fra: number, varighet: number, ignorerKode?: string) {
  return erLedig(dato, fra, varighet, opptattFor(behandlingId, behandlerId, dato, await bookingerForDag(dato), ignorerKode));
}

function sjekkIkkeForSent(dato: string, min: number, naa: Date) {
  const n = naaOslo(naa);
  if (dato < n.dato || (dato === n.dato && min < n.minutter + MIN_VARSEL_MIN)) {
    throw new Brukerfeil("Tidspunktet har passert eller er for nært. Velg en tid minst én time frem i tid.");
  }
}

// ---------- tools ----------

export interface LedigTid {
  tidspunkt: string;
  lesbar: string;
  behandler_id: string;
  behandler_navn: string;
  varighet_min: number;
}

export async function finnLedigeTider(
  input: { behandling: string; fra_dato?: string; behandler?: string },
  naa = new Date(),
): Promise<{ behandling: string; varighet_min: number; ledige_tider: LedigTid[] }> {
  const b = hentBehandling(input.behandling);
  const behandlere = aktuelleBehandlere(b, input.behandler || undefined);
  const idag = naaOslo(naa);
  if (input.fra_dato && !gyldigDato(input.fra_dato)) throw new Brukerfeil(`Ugyldig dato «${input.fra_dato}». Bruk ÅÅÅÅ-MM-DD.`);
  let dato = input.fra_dato && input.fra_dato > idag.dato ? input.fra_dato : idag.dato;

  const funnet: LedigTid[] = [];
  for (let i = 0; i < SOKEHORISONT_DAGER && funnet.length < MAKS_FORSLAG; i++, dato = leggTilDager(dato, 1)) {
    if (!erArbeidsdag(dato)) continue;
    const tidligst = dato === idag.dato ? idag.minutter + MIN_VARSEL_MIN : APNER;
    const dagensForslag: LedigTid[] = [];
    // Maks to forslag per dag, så forslagene spres utover. Med flere behandlere: første ledige
    // tid hos hver. Med én behandler: to tider med minst en time mellom.
    const perBehandler = behandlere.length === 1 ? 2 : 1;
    const dagensBookinger = await bookingerForDag(dato);
    for (const behandler of behandlere) {
      const opptatt = opptattFor(b.id, behandler.id, dato, dagensBookinger);
      let sist = -Infinity;
      let antall = 0;
      for (let fra = Math.ceil(tidligst / STEG) * STEG; fra + b.varighet_min! <= STENGER && antall < perBehandler; fra += STEG) {
        if (fra - sist < 60) continue;
        if (erLedig(dato, fra, b.varighet_min!, opptatt)) {
          const tidspunkt = `${dato}T${klokke(fra)}`;
          dagensForslag.push({ tidspunkt, lesbar: formaterTidspunkt(tidspunkt), behandler_id: behandler.id, behandler_navn: behandler.navn, varighet_min: b.varighet_min! });
          sist = fra;
          antall++;
        }
      }
    }
    dagensForslag.sort((x, y) => x.tidspunkt.localeCompare(y.tidspunkt));
    funnet.push(...dagensForslag.slice(0, 2));
  }
  return { behandling: b.navn, varighet_min: b.varighet_min!, ledige_tider: funnet.slice(0, MAKS_FORSLAG) };
}

export interface Dagtid {
  tid: string;
  tidspunkt: string;
  behandler_id: string;
  behandler_navn: string;
}

const VELGER_STEG = 30;
const MAKS_VELGER_DAGER = 42;

/**
 * Alle ledige tider per dag i et datointervall, for kalendervisningen i widgeten.
 * Halvtimes-rutenett, og én behandler per klokkeslett (første ledige i ansattlisten).
 */
export async function ledigeTiderPerDag(
  input: { behandling: string; fra_dato: string; til_dato: string; behandler?: string },
  naa = new Date(),
): Promise<{ behandling: string; varighet_min: number; dager: Record<string, Dagtid[]> }> {
  const b = hentBehandling(input.behandling);
  const behandlere = aktuelleBehandlere(b, input.behandler || undefined);
  if (!gyldigDato(input.fra_dato) || !gyldigDato(input.til_dato) || input.til_dato < input.fra_dato) {
    throw new Brukerfeil("Ugyldig datointervall.");
  }
  const idag = naaOslo(naa);
  const dager: Record<string, Dagtid[]> = {};
  let dato = input.fra_dato > idag.dato ? input.fra_dato : idag.dato;
  for (let i = 0; dato <= input.til_dato && i < MAKS_VELGER_DAGER; i++, dato = leggTilDager(dato, 1)) {
    if (!erArbeidsdag(dato)) continue;
    const tidligst = dato === idag.dato ? idag.minutter + MIN_VARSEL_MIN : APNER;
    const dagensBookinger = await bookingerForDag(dato);
    const opptatt = behandlere.map((a) => ({ a, opptatt: opptattFor(b.id, a.id, dato, dagensBookinger) }));
    const tider: Dagtid[] = [];
    for (let fra = Math.ceil(tidligst / VELGER_STEG) * VELGER_STEG; fra + b.varighet_min! <= STENGER; fra += VELGER_STEG) {
      const ledig = opptatt.find((o) => erLedig(dato, fra, b.varighet_min!, o.opptatt));
      if (ledig) tider.push({ tid: klokke(fra), tidspunkt: `${dato}T${klokke(fra)}`, behandler_id: ledig.a.id, behandler_navn: ledig.a.navn });
    }
    if (tider.length) dager[dato] = tider;
  }
  return { behandling: b.navn, varighet_min: b.varighet_min!, dager };
}

export function normaliserTelefon(telefon: string): string {
  let siffer = (telefon ?? "").replace(/[\s\-().]/g, "");
  if (siffer.startsWith("+47")) siffer = siffer.slice(3);
  else if (siffer.startsWith("0047")) siffer = siffer.slice(4);
  if (!/^[2-9]\d{7}$/.test(siffer)) throw new Brukerfeil("Telefonnummeret må være et norsk nummer med 8 siffer.");
  return siffer;
}

function sjekkKontakt(navn: string, epost: string) {
  if (!navn?.trim() || navn.trim().length > 100) throw new Brukerfeil("Mangler gyldig navn.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost?.trim() ?? "")) throw new Brukerfeil("E-postadressen ser ikke gyldig ut.");
}

const KODETEGN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function nyKode(): string {
  let kode = "TTK-";
  for (let i = 0; i < 5; i++) kode += KODETEGN[Math.floor(Math.random() * KODETEGN.length)];
  return kode;
}

export function bekreftelse(booking: Booking) {
  return {
    bookingkode: booking.kode,
    behandling_id: booking.behandling_id,
    behandling: behandlinger.find((b) => b.id === booking.behandling_id)?.navn ?? booking.behandling_id,
    behandler: behandlerNavn(booking.behandler_id),
    tidspunkt: booking.tidspunkt,
    lesbar: formaterTidspunkt(booking.tidspunkt),
    varighet_min: booking.varighet_min,
    navn: booking.navn,
    kommentar: booking.kommentar ?? null,
    adresse: `${klinikk.adresse.gate}, ${klinikk.adresse.etasje}, ${klinikk.adresse.postnummer} ${klinikk.adresse.sted}`,
    gebyr_ikke_mott: klinikk.gebyr_ikke_mott.beskrivelse,
  };
}

async function reserver(booking: Booking) {
  const { dato, min } = tolkTidspunkt(booking.tidspunkt);
  const dag = await bookingerForDag(dato);
  dag.push({ kode: booking.kode, behandler_id: booking.behandler_id, fra: min, til: min + booking.varighet_min });
  await hentLager().lagre(dagNokkel(dato), dag, BOOKING_TTL_SEK);
  await hentLager().lagre(bookingNokkel(booking.kode), booking, BOOKING_TTL_SEK);
}

async function frigi(booking: Booking) {
  const { dato } = tolkTidspunkt(booking.tidspunkt);
  const dag = (await bookingerForDag(dato)).filter((b) => b.kode !== booking.kode);
  await hentLager().lagre(dagNokkel(dato), dag, BOOKING_TTL_SEK);
}

export async function bestillTime(
  input: { behandling: string; tidspunkt: string; behandler: string; navn: string; telefon: string; epost: string; kommentar?: string },
  naa = new Date(),
) {
  const b = hentBehandling(input.behandling);
  const [behandler] = aktuelleBehandlere(b, input.behandler);
  const { dato, min } = tolkTidspunkt(input.tidspunkt);
  sjekkIkkeForSent(dato, min, naa);
  const telefon = normaliserTelefon(input.telefon);
  sjekkKontakt(input.navn, input.epost);
  if (inneholderHelseopplysninger(input.kommentar)) throw new Brukerfeil(`Kommentaren ser ut til å inneholde helseopplysninger. ${HELSE_SVAR}`);
  if (!(await erLedigNa(b.id, behandler.id, dato, min, b.varighet_min!))) {
    throw new Brukerfeil("Tiden er ikke ledig lenger. Velg en annen tid.");
  }

  let kode = nyKode();
  while (await hentLager().hent(bookingNokkel(kode))) kode = nyKode();
  const booking: Booking = {
    kode,
    behandling_id: b.id,
    behandler_id: behandler.id,
    tidspunkt: `${dato}T${klokke(min)}`,
    varighet_min: b.varighet_min!,
    navn: input.navn.trim(),
    telefon,
    epost: input.epost.trim(),
    kommentar: input.kommentar?.trim().slice(0, MAKS_KOMMENTAR) || undefined,
    opprettet: naa.toISOString(),
    gjennomgang: "ny",
  };
  await reserver(booking);
  await hentLager().leggTilListe("bookinglogg", booking.kode);
  await varsleKlinikksystem("opprettet", booking, naa);
  return { status: "reservert", gjennomgang: "venter på klinikkens bekreftelse", ...bekreftelse(booking) };
}

export interface BookingOversikt extends Booking {
  behandling_navn: string;
  behandler_navn: string;
  lesbar: string;
  status: "aktiv" | "avbestilt";
  gjennomgang: Gjennomgang;
}

/** Alle bestillinger gjort via assistenten, nyeste først, for sekretærens gjennomgang i /admin. */
export async function hentBookingerTilGjennomgang(): Promise<BookingOversikt[]> {
  const koder = [...new Set(await hentLager().hentListe<string>("bookinglogg"))].reverse();
  const bookinger = await Promise.all(koder.map((k) => hentLager().hent<Booking>(bookingNokkel(k))));
  return koder.map((kode, i) => {
    const b = bookinger[i];
    if (!b) {
      return {
        kode, behandling_id: "", behandler_id: "", tidspunkt: "", varighet_min: 0, navn: "", telefon: "", epost: "", opprettet: "",
        behandling_navn: "", behandler_navn: "", lesbar: "", status: "avbestilt" as const, gjennomgang: "ny" as const,
      };
    }
    return {
      ...b,
      behandling_navn: behandlinger.find((x) => x.id === b.behandling_id)?.navn ?? b.behandling_id,
      behandler_navn: behandlerNavn(b.behandler_id),
      lesbar: formaterTidspunkt(b.tidspunkt),
      status: "aktiv" as const,
      gjennomgang: b.gjennomgang ?? "ny",
    };
  });
}

async function hentVerifisert(bookingkode: string, telefon: string): Promise<Booking> {
  const kode = (bookingkode ?? "").trim().toUpperCase();
  let tlf: string | null = null;
  try {
    tlf = normaliserTelefon(telefon);
  } catch {
    // behandles som ikke funnet under
  }
  const booking = await hentLager().hent<Booking>(bookingNokkel(kode));
  // Samme svar uansett om koden eller telefonen er feil, så koder ikke kan gjettes.
  if (!booking || booking.telefon !== tlf || booking.gjennomgang === "avvist") {
    throw new Brukerfeil("Fant ingen aktiv time med den bookingkoden og det telefonnummeret.");
  }
  return booking;
}

export async function finnBooking(input: { bookingkode: string; telefon: string }) {
  const booking = await hentVerifisert(input.bookingkode, input.telefon);
  return { status: "funnet", ...bekreftelse(booking) };
}

export async function flyttTime(
  input: { bookingkode: string; telefon: string; nytt_tidspunkt: string; behandler?: string },
  naa = new Date(),
) {
  const booking = await hentVerifisert(input.bookingkode, input.telefon);
  const b = hentBehandling(booking.behandling_id);
  const [behandler] = aktuelleBehandlere(b, input.behandler || booking.behandler_id);
  const { dato, min } = tolkTidspunkt(input.nytt_tidspunkt);
  sjekkIkkeForSent(dato, min, naa);
  if (!(await erLedigNa(b.id, behandler.id, dato, min, booking.varighet_min, booking.kode))) {
    throw new Brukerfeil(`${behandler.navn} er ikke ledig da. Velg en annen tid.`);
  }
  const gammel = formaterTidspunkt(booking.tidspunkt);
  await frigi(booking);
  // Ny tid må gjennomgås på nytt av klinikken.
  const flyttet: Booking = { ...booking, behandler_id: behandler.id, tidspunkt: `${dato}T${klokke(min)}`, gjennomgang: "ny", behandlet: undefined };
  await reserver(flyttet);
  await varsleKlinikksystem("flyttet", flyttet, naa);
  return { status: "flyttet", fra: gammel, ...bekreftelse(flyttet) };
}

export async function avbestillTime(input: { bookingkode: string; telefon: string }) {
  const booking = await hentVerifisert(input.bookingkode, input.telefon);
  await frigi(booking);
  await hentLager().slett(bookingNokkel(booking.kode));
  await varsleKlinikksystem("avbestilt", booking);
  return { status: "avbestilt", bookingkode: booking.kode, var: formaterTidspunkt(booking.tidspunkt) };
}

/**
 * Sekretærens gjennomgang i /admin. Bekreft: timen står. Avvis: tiden frigis, og bookingen
 * kan ikke lenger endres av pasienten (klinikken tar kontakt). Varsler klinikksystemet.
 */
export async function behandleBooking(kode: string, handling: "bekreft" | "avvis", naa = new Date()): Promise<Booking> {
  const booking = await hentLager().hent<Booking>(bookingNokkel(kode.trim().toUpperCase()));
  if (!booking) throw new Brukerfeil("Fant ikke bestillingen. Den kan være avbestilt.");
  if ((booking.gjennomgang ?? "ny") !== "ny") throw new Brukerfeil(`Bestillingen er allerede ${booking.gjennomgang}.`);
  const oppdatert: Booking = { ...booking, gjennomgang: handling === "bekreft" ? "bekreftet" : "avvist", behandlet: naa.toISOString() };
  if (handling === "avvis") await frigi(booking);
  await hentLager().lagre(bookingNokkel(booking.kode), oppdatert, BOOKING_TTL_SEK);
  await varsleKlinikksystem(handling === "bekreft" ? "bekreftet" : "avvist", oppdatert, naa);
  return oppdatert;
}

export interface Henvendelse {
  id: string;
  mottatt: string;
  oppsummering: string;
  kontaktinfo: string;
}

export async function overforTilKlinikken(input: { oppsummering: string; kontaktinfo: string }, naa = new Date()) {
  if (!input.oppsummering?.trim()) throw new Brukerfeil("Oppsummeringen mangler.");
  if (!input.kontaktinfo?.trim()) throw new Brukerfeil("Kontaktinfo mangler. Be om telefon eller e-post.");
  const henvendelse: Henvendelse = {
    id: crypto.randomUUID(),
    mottatt: naa.toISOString(),
    oppsummering: input.oppsummering.trim().slice(0, 1000),
    kontaktinfo: input.kontaktinfo.trim().slice(0, 200),
  };
  await hentLager().leggTilListe("henvendelser", henvendelse);
  return { status: "overført", melding: "Klinikken har fått henvendelsen og tar kontakt i åpningstiden (man–fre 08–16)." };
}

export const hentHenvendelser = () => hentLager().hentListe<Henvendelse>("henvendelser");
