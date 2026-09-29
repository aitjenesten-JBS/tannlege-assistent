import { timingSafeEqual } from "node:crypto";

// Tilgangskode for AI-chatten i den offentlige demoen. Uten DEMO_TILGANG (lokalt) er alt åpent.
// Med kode: bare forespørsler med riktig kode bruker modellen (og API-kredittene). Andre får
// den skriptede demoen, og kalender, skjema og admin virker uansett.
export const TILGANG_HEADER = "x-demo-tilgang";

export function harAiTilgang(request: Request): boolean {
  const kode = process.env.DEMO_TILGANG?.trim();
  if (!kode) return true;
  const gitt = Buffer.from(request.headers.get(TILGANG_HEADER)?.trim() ?? "");
  const riktig = Buffer.from(kode);
  return gitt.length === riktig.length && timingSafeEqual(gitt, riktig);
}
