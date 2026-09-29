import klinikk from "@/data/klinikk.json";
import { feil, lesJson, sjekkGrense, UUID } from "@/lib/api";
import { svar } from "@/lib/assistent";
import { sendBekreftelse } from "@/lib/epost";
import { erFrakoblet } from "@/lib/frakoblet";
import { bestillTime, Brukerfeil } from "@/lib/kalender";

export const maxDuration = 60;

// Booking fra skjemaet i kalenderen. Bookingen gjøres direkte i timeboken, og modellen får
// den bekreftede bookingen som en system-melding, så den kan bekrefte i chatten.
export async function POST(request: Request) {
  const body = await lesJson(request);
  if (!body) return feil(400, "Ugyldig forespørsel.");
  const tekst = (felt: string) => (typeof body[felt] === "string" ? (body[felt] as string) : "");
  const samtaleId = tekst("samtaleId");
  if (!UUID.test(samtaleId)) return feil(400, "Ugyldig samtale-id.");

  const begrenset = await sjekkGrense(request, "kalender");
  if (begrenset) return begrenset;

  let booking: Awaited<ReturnType<typeof bestillTime>>;
  try {
    booking = await bestillTime({
      behandling: tekst("behandling"),
      tidspunkt: tekst("tidspunkt"),
      behandler: tekst("behandler"),
      navn: tekst("navn").slice(0, 100),
      telefon: tekst("telefon"),
      epost: tekst("epost").slice(0, 200),
      kommentar: tekst("kommentar"),
    });
  } catch (e) {
    if (e instanceof Brukerfeil) return feil(409, e.message);
    console.error(e);
    return feil(500, `Kunne ikke bestille timen. Prøv igjen, eller ring klinikken på ${klinikk.telefon}.`);
  }

  const epost = await sendBekreftelse(booking, tekst("epost"));

  // Modellen skriver bekreftelsen. Feiler det (f.eks. uten API-nøkkel), er bookingen likevel
  // gjort, og widgeten viser en bekreftelse bygget fra bookingdataene.
  let bekreftelse: string | null = null;
  if (!erFrakoblet()) try {
    const res = await svar(
      samtaleId,
      `Jeg har valgt ${booking.lesbar} hos ${booking.behandler} og sendt inn skjemaet.`,
      new Date(),
      `Pasienten har bestilt time via skjemaet i kalenderen, og timeboken har bekreftet bookingen: ${JSON.stringify(booking)}. ` +
        (epost === "sendt"
          ? "Bekreftelse er sendt på e-post. "
          : "E-post ble ikke sendt (demo). Widgeten viser en forhåndsvisning av e-posten og en knapp for å legge timen i kalenderen. ") +
        "Bekreft kort med dag, klokkeslett, behandler og bookingkode, si at koden og telefonnummeret trengs for å endre timen, og nevn gebyret ved uteblivelse. Ikke kall bestill_time.",
    );
    bekreftelse = res.tekst;
  } catch (e) {
    console.error("Bekreftelse fra modellen feilet:", e instanceof Error ? e.message : e);
  }

  return Response.json({ booking, svar: bekreftelse, epost });
}
