import { harAdminTilgang } from "@/lib/admin";
import { feil, lesJson } from "@/lib/api";
import { sendBekreftelse } from "@/lib/epost";
import { behandleBooking, bekreftelse, Brukerfeil } from "@/lib/kalender";

// Sekretærens gjennomgang: bekreft eller avvis en bestilling. Varsler klinikksystemet
// (webhook, via behandleBooking) og sender pasienten e-post om utfallet.
// POST { kode, handling: "bekreft" | "avvis", nokkel? }
export async function POST(request: Request) {
  const body = await lesJson(request);
  if (!body) return feil(400, "Ugyldig forespørsel.");
  if (!harAdminTilgang(typeof body.nokkel === "string" ? body.nokkel : null)) return feil(404, "Ikke funnet.");
  const kode = typeof body.kode === "string" ? body.kode : "";
  const handling = body.handling === "bekreft" || body.handling === "avvis" ? body.handling : null;
  if (!kode || !handling) return feil(400, "Mangler kode eller handling.");

  try {
    const booking = await behandleBooking(kode, handling);
    const epost = await sendBekreftelse(bekreftelse(booking), booking.epost, handling === "bekreft" ? "bekreftet" : "avvist");
    return Response.json({ kode: booking.kode, gjennomgang: booking.gjennomgang, epost });
  } catch (e) {
    if (e instanceof Brukerfeil) return feil(409, e.message);
    console.error(e);
    return feil(500, "Kunne ikke oppdatere bestillingen.");
  }
}
