// Bekreftelsesmail. Ren modul: serveren sender den, og widgeten viser samme mal som forhåndsvisning.

export interface EpostTime {
  bookingkode: string;
  behandling: string;
  behandler: string;
  lesbar: string; // "onsdag 7. oktober kl. 08:00"
  varighet_min: number;
  navn: string;
  adresse: string;
  gebyr_ikke_mott: string;
  kommentar?: string | null;
}

// mottatt: rett etter bestilling (tiden er reservert). bekreftet/avvist: etter klinikkens gjennomgang.
export type EpostType = "mottatt" | "bekreftet" | "avvist";

const INNHOLD: Record<EpostType, { emne: string; ingress: string }> = {
  mottatt: {
    emne: "Bestilling mottatt",
    ingress: "Vi har mottatt bestillingen din, og tiden er reservert. Klinikken går gjennom bestillingen og sender deg en bekreftelse.",
  },
  bekreftet: { emne: "Timen er bekreftet", ingress: "Klinikken har gått gjennom bestillingen, og timen din er bekreftet." },
  avvist: {
    emne: "Om bestillingen din",
    ingress: "Klinikken kunne dessverre ikke bekrefte denne timen. Vi tar kontakt med deg for å finne en annen løsning, eller du kan ringe oss.",
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stor = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function epostEmne(t: EpostTime, type: EpostType = "mottatt") {
  return `${INNHOLD[type].emne}: ${t.behandling.toLowerCase()} ${t.lesbar}`;
}

export function epostTekst(t: EpostTime, type: EpostType = "mottatt") {
  return [
    `Hei ${t.navn}!`,
    "",
    INNHOLD[type].ingress,
    "",
    `${stor(t.lesbar)}`,
    `${t.behandling}, ${t.varighet_min} min, hos ${t.behandler}`,
    `${t.adresse}`,
    "",
    `Bookingkode: ${t.bookingkode}`,
    t.kommentar ? `Din kommentar: ${t.kommentar}` : null,
    "",
    "Endre eller avbestille: bruk chatten på nettsiden med bookingkoden og telefonnummeret, eller ring 12 34 56 78 (man–fre 08–16).",
    `${t.gebyr_ikke_mott}.`,
    "",
    "Hilsen Torget Tannklinikk (tidligere Tannlegene Holm)",
    "",
    "Demo: dette er et porteføljeprosjekt, ikke en ekte time.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function epostHtml(t: EpostTime, type: EpostType = "mottatt") {
  const rad = (etikett: string, verdi: string) =>
    `<tr><td style="padding:6px 0;color:#6d7a77;font-size:13px;width:110px;vertical-align:top">${etikett}</td><td style="padding:6px 0;color:#10302f;font-size:15px">${verdi}</td></tr>`;
  return `<!doctype html><html lang="nb"><body style="margin:0;background:#f7f4ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ee;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf9;border:1px solid #ddd5c8;border-radius:16px;overflow:hidden">
<tr><td style="background:#10302f;padding:20px 24px;color:#f7f4ee">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:22px">Torget Tannklinikk</div>
<div style="font-size:12px;opacity:.7;margin-top:2px">Tidligere Tannlegene Holm · Torggata 7, Fjordvik</div>
</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 4px;color:#10302f;font-size:15px">Hei ${esc(t.navn)}!</p>
<p style="margin:0 0 18px;color:#2c4a48;font-size:15px">${INNHOLD[type].ingress}</p>
<div style="background:#e3ecea;border-radius:12px;padding:14px 16px;margin-bottom:18px">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:21px;color:#10302f">${esc(stor(t.lesbar))}</div>
<div style="font-size:13px;color:#2c4a48;margin-top:2px">${esc(t.behandling)} · ${t.varighet_min} min · ${esc(t.behandler)}</div>
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rad("Bookingkode", `<strong style="letter-spacing:.04em">${esc(t.bookingkode)}</strong>`)}
${rad("Adresse", `${esc(t.adresse)}<br><span style="color:#6d7a77;font-size:13px">2. etasje, ved torget</span>`)}
${t.kommentar ? rad("Kommentar", esc(t.kommentar)) : ""}
</table>
<p style="margin:18px 0 0;color:#2c4a48;font-size:13px;line-height:1.5">Vil du endre eller avbestille? Bruk chatten på nettsiden med bookingkoden og telefonnummeret ditt, eller ring <a href="tel:+4712345678" style="color:#1d5552">12 34 56 78</a> (man–fre 08–16).</p>
<p style="margin:10px 0 0;color:#6d7a77;font-size:12px">${esc(t.gebyr_ikke_mott)}.</p>
</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #ddd5c8;color:#6d7a77;font-size:11px">Demo: dette er et porteføljeprosjekt, ikke en ekte time.${type === "avvist" ? "" : " Kalenderfil er vedlagt."}</td></tr>
</table></td></tr></table></body></html>`;
}
