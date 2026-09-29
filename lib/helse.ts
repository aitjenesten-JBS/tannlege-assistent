// Enkel ordlistesjekk for helseopplysninger i fritekst (kommentarfeltet). Brukes i nettleseren
// for rask tilbakemelding og på serveren for håndheving. Bevisst streng: heller en falsk positiv
// (pasienten fjerner teksten) enn at helseopplysninger lagres i en demo uten databehandleravtale.

export const HELSE_SVAR =
  "Helseopplysninger kan ikke AI-assistenten ta imot eller svare på. Ta kontakt med klinikken på 12 34 56 78 (man–fre 08–16), så hjelper de deg.";

const ORD = [
  "vondt", "smerte", "verk", "verker", "hoven", "hovent", "hevelse", "blør", "blødning", "blødd",
  "infeksjon", "betennelse", "betent", "puss", "feber", "abscess", "byll",
  "medisin", "antibiotika", "penicillin", "paracet", "ibux", "smertestillende", "allergi", "allergisk",
  "gravid", "diabetes", "hjerte", "blodfortynnende", "epilepsi", "astma", "kreft", "cellegift",
  "diagnose", "sykdom", "syk", "angst",
  "ising", "ilning", "ømhet", "øm", "sår", "sårt",
  // Bevisst ikke med: behandlingsønsker som «trekke visdomstann», «knekt fylling» eller
  // «tannlegeskrekk». Det er nettopp det kommentarfeltet er til for, og sekretæren trenger det.
];

const monster = new RegExp(`(^|[^a-zæøå])(${ORD.map((o) => o.replace(/ /g, "\\s+")).join("|")})`, "i");

export function inneholderHelseopplysninger(tekst: string | undefined | null): boolean {
  return Boolean(tekst && monster.test(tekst.toLowerCase()));
}
