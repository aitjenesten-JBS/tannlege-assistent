import ansatte from "@/data/ansatte.json";
import klinikk from "@/data/klinikk.json";
import priser from "@/data/priser.json";
import { avbestillTime, Brukerfeil, finnBooking, flyttTime, naaOslo, sjekkBehandling } from "@/lib/kalender";
import { hentLager } from "@/lib/lagring";
import { HELSESETNING } from "@/lib/systemprompt";
import { MANEDER } from "@/lib/tidsformat";
import type { Tidsvelger } from "@/lib/tools";

// Frakoblet demomodus (FRAKOBLET=1): skriptede svar basert på nøkkelord, uten språkmodell.
// Brukes for å vise og teste arbeidsflyten (kalender, skjema, flytt, avbestill) gratis.
// Kalenderen, bookingene og admin er de ekte. Dette er IKKE assistenten, bare en stand-in.

export const erFrakoblet = () => process.env.FRAKOBLET === "1";

interface Tilstand {
  venter?: "avbestill" | "flytt" | "anbefalt";
  behandling?: string;
  kode?: string;
  telefon?: string;
}

export interface FrakobletSvar {
  tekst: string;
  tidsvelger?: Tidsvelger;
}

const pris = (id: string) => {
  const p = priser.find((x) => x.id === id);
  return p?.pris_kr ? `${p.pris_kr} kr` : (p?.merknad ?? "ta kontakt med klinikken");
};
const har = (tekst: string, ...ord: string[]) => ord.some((o) => tekst.includes(o));

function erApen(naa: Date) {
  const { dato, minutter } = naaOslo(naa);
  const dag = new Date(`${dato}T00:00:00Z`).getUTCDay();
  return dag >= 1 && dag <= 5 && minutter >= 480 && minutter < 960;
}

function velger(behandling: string, formaal: "ny_time" | "flytte" = "ny_time", behandler?: string): Tidsvelger {
  return { formaal, ...sjekkBehandling(behandling), behandler };
}

function tolkFlyttValg(tekst: string, naa: Date): { tidspunkt: string; behandler?: string } | null {
  const m = new RegExp(`(\\d{1,2})\\. (${MANEDER.join("|")}) kl\\. (\\d{2}:\\d{2}) hos (.+?)\\.?$`).exec(tekst);
  if (!m) return null;
  const mnd = MANEDER.indexOf(m[2]) + 1;
  const iAar = Number(naaOslo(naa).dato.slice(0, 4));
  const aar = mnd < Number(naaOslo(naa).dato.slice(5, 7)) ? iAar + 1 : iAar;
  const tidspunkt = `${aar}-${String(mnd).padStart(2, "0")}-${m[1].padStart(2, "0")}T${m[3]}`;
  return { tidspunkt, behandler: ansatte.find((a) => a.navn === m[4].trim())?.id };
}

export async function frakobletSvar(samtaleId: string, melding: string, naa = new Date()): Promise<FrakobletSvar> {
  const lager = hentLager();
  const nokkel = `frakoblet:${samtaleId}`;
  const tilstand = (await lager.hent<Tilstand>(nokkel)) ?? {};
  const t = melding.toLowerCase();
  const lagre = (ny: Tilstand) => lager.lagre(nokkel, ny, 3600);

  // --- pågående flyt: bookingkode + telefon ---
  const kode = /ttk-[a-z2-9]{5}/i.exec(melding)?.[0];
  const telefon = /(\+47|0047)?\s*[2-9](\s*\d){7}/.exec(melding)?.[0];
  if ((tilstand.venter === "avbestill" || tilstand.venter === "flytt") && kode && telefon) {
    try {
      const booking = await finnBooking({ bookingkode: kode, telefon });
      if (tilstand.venter === "avbestill") {
        await avbestillTime({ bookingkode: kode, telefon });
        await lagre({});
        return { tekst: `Timen din ${booking.lesbar} hos ${booking.behandler} er avbestilt. Velkommen tilbake en annen gang!` };
      }
      await lagre({ venter: "flytt", kode, telefon });
      return {
        tekst: `Jeg fant timen din: ${booking.behandling.toLowerCase()} ${booking.lesbar} hos ${booking.behandler}. Velg ny tid i kalenderen under.`,
        tidsvelger: velger(booking.behandling_id, "flytte"),
      };
    } catch (e) {
      if (e instanceof Brukerfeil) return { tekst: `${e.message} Sjekk koden og nummeret, eller ring klinikken på ${klinikk.telefon}.` };
      throw e;
    }
  }
  if (tilstand.venter === "flytt" && tilstand.kode && t.startsWith("jeg vil flytte timen til")) {
    const valg = tolkFlyttValg(melding, naa);
    if (valg) {
      try {
        const res = await flyttTime({ bookingkode: tilstand.kode, telefon: tilstand.telefon!, nytt_tidspunkt: valg.tidspunkt, behandler: valg.behandler }, naa);
        await lagre({});
        return { tekst: `Da er timen flyttet fra ${res.fra} til **${res.lesbar}** hos ${res.behandler}. Bookingkoden er den samme.` };
      } catch (e) {
        if (e instanceof Brukerfeil) return { tekst: e.message };
        throw e;
      }
    }
  }
  if (tilstand.venter === "anbefalt" && tilstand.behandling) {
    await lagre({});
    if (/(^|s)ja/.test(t)) {
      const b = sjekkBehandling(tilstand.behandling);
      return { tekst: `Flott. Jeg setter opp ${b.behandling_navn.toLowerCase()}, ${b.varighet_min} minutter. Velg tid i kalenderen under.`, tidsvelger: velger(tilstand.behandling) };
    }
    return {
      tekst: `Da må tannlegen se på det først. Jeg setter opp en undersøkelse, 45 minutter, ${pris("undersokelse")}. Skriv gjerne hva du ønsker i feltet «Hva gjelder timen?».`,
      tidsvelger: velger("undersokelse"),
    };
  }

  // --- røde flagg og helse (går foran alt annet) ---
  if (har(t, "puste", "svelge")) return { tekst: `Ring ${klinikk.nodnumre.akutt_livstruende.nummer} nå. ${HELSESETNING}` };
  if (har(t, "hevelse", "hoven", "feber", "blør", "blødning", "svimmel", "slått ut", "slo ut")) {
    const hvor = erApen(naa)
      ? `Det haster. Ring klinikken på ${klinikk.telefon} med en gang.`
      : `Det haster. Ring legevakt på ${klinikk.nodnumre.legevakt.nummer} nå.`;
    return { tekst: `${hvor} ${HELSESETNING}` };
  }
  if (har(t, "diagnose", "medisin", "antibiotik", "smertestillende", "blodfortynnende", "gravid", "allergi")) {
    return { tekst: HELSESETNING };
  }
  if (har(t, "akutt", "tannpine", "vondt", "smerte", "verk")) {
    return { tekst: `${HELSESETNING} Jeg kan sette opp en akutt-time til deg, 30 minutter. Velg tid under.`, tidsvelger: velger("akutt") };
  }

  // --- avbestill / flytt ---
  if (har(t, "avbestill", "avlys")) {
    await lagre({ venter: "avbestill" });
    return { tekst: "Det ordner jeg. Hva er bookingkoden din (f.eks. TTK-AB12C) og telefonnummeret du bestilte med?" };
  }
  if (har(t, "flytt", "endre time", "annen tid")) {
    await lagre({ venter: "flytt" });
    return { tekst: "Det ordner jeg. Hva er bookingkoden din (f.eks. TTK-AB12C) og telefonnummeret du bestilte med?" };
  }

  // --- priser og info (før booking, så «hva koster en fylling» ikke tolkes som bestilling) ---
  if (har(t, "koster", "pris")) {
    if (har(t, "fylling")) return { tekst: `En fylling koster ${pris("fylling_1_flate")} for 1 flate, ${pris("fylling_2_flater")} for 2 flater og ${pris("fylling_3_flater")} for 3 flater.` };
    if (har(t, "rotfylling")) return { tekst: `En rotfylling koster ${pris("rotfylling_1_kanal")} for 1 kanal, ${pris("rotfylling_2_kanaler")} for 2 kanaler og ${pris("rotfylling_3_4_kanaler")} for 3–4 kanaler.` };
    if (har(t, "bleking")) return { tekst: "Tannbleking står ikke i prislisten. Ta kontakt med klinikken for pris." };
    return {
      tekst: `Noen vanlige priser:\n- Undersøkelse med 2 røntgen, puss og lett rens: ${pris("undersokelse")}\n- Fylling: fra ${pris("fylling_1_flate")}\n- Ukomplisert trekking: ${pris("trekking")}\n- Rotfylling: fra ${pris("rotfylling_1_kanal")}\n\nVil du bestille en undersøkelse?`,
    };
  }
  if (har(t, "åpningstid", "åpent", "åpen")) return { tekst: "Vi har åpent mandag til fredag 08:00–16:00, og er stengt lørdag og søndag." };
  if (har(t, "adresse", "ligger", "parker", "finne dere")) {
    return { tekst: `Vi holder til i ${klinikk.adresse.gate}, ${klinikk.adresse.etasje}, ved torget i Fjordvik. Parkering: ${klinikk.parkering.steder.join(", ")} (betal p-avgift).` };
  }

  // --- bestilling ---
  const spesifikk = [
    ["trekk", "trekking"],
    ["rotfyll", "rotfylling"],
    ["fylling", "fylling_1_flate"],
    ["etterkontroll", "etterkontroll"],
  ].find(([ord]) => t.includes(ord));
  if (spesifikk) {
    await lagre({ venter: "anbefalt", behandling: spesifikk[1] });
    return { tekst: "Har tannlegen her anbefalt dette etter en undersøkelse? Svar ja eller nei." };
  }
  if (har(t, "bleking", "hvitere", "krone", "implantat", "fasett")) {
    return {
      tekst: `Det må tannlegen vurdere først, så jeg setter opp en undersøkelse, 45 minutter, ${pris("undersokelse")}. Skriv hva du ønsker i feltet «Hva gjelder timen?».`,
      tidsvelger: velger("undersokelse"),
    };
  }
  if (har(t, "bestill", "time", "undersøkelse", "kontroll", "sjekk", "ny pasient")) {
    return { tekst: `Jeg setter opp en undersøkelse, 45 minutter, ${pris("undersokelse")}. Velg dag og tid i kalenderen under.`, tidsvelger: velger("undersokelse") };
  }

  return {
    tekst: "I den frakoblede demoen forstår jeg bare enkle ting: bestille time, priser, åpningstider, akutt, flytte og avbestille. Prøv for eksempel «Jeg vil bestille time».",
  };
}
