import { feil, sjekkGrense } from "@/lib/api";
import { Brukerfeil, ledigeTiderPerDag } from "@/lib/kalender";

// Ledige tider per dag for kalendervisningen i widgeten. Går rett mot timeboken, uten modellen.
// GET /api/ledige?behandling=undersokelse&fra=2026-10-01&til=2026-10-31[&behandler=sara_haugen]
export async function GET(request: Request) {
  const begrenset = await sjekkGrense(request, "kalender");
  if (begrenset) return begrenset;

  const p = new URL(request.url).searchParams;
  try {
    const resultat = await ledigeTiderPerDag({
      behandling: p.get("behandling") ?? "",
      fra_dato: p.get("fra") ?? "",
      til_dato: p.get("til") ?? "",
      behandler: p.get("behandler") ?? undefined,
    });
    return Response.json(resultat);
  } catch (e) {
    if (e instanceof Brukerfeil) return feil(400, e.message);
    console.error(e);
    return feil(500, "Kunne ikke hente ledige tider.");
  }
}
