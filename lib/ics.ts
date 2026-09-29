// Kalenderfil (.ics) for en bekreftet time. Ren modul: brukes både som e-postvedlegg på
// serveren og som nedlasting i widgeten.

export interface IcsTime {
  bookingkode: string;
  behandling: string;
  behandler: string;
  tidspunkt: string; // "2026-10-07T08:00", Oslo-tid
  varighet_min: number;
  adresse: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const utcStempel = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

/** Oslo-veggklokke → UTC, uten tidssonebibliotek (håndterer sommer- og vintertid). */
export function osloTilUtc(tidspunkt: string): Date {
  const [dato, tid] = tidspunkt.split("T");
  const [a, m, d] = dato.split("-").map(Number);
  const [t, min] = tid.split(":").map(Number);
  const somUtc = Date.UTC(a, m - 1, d, t, min);
  const deler = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(somUtc)).map((p) => [p.type, p.value]),
  );
  const osloSomUtc = Date.UTC(+deler.year, +deler.month - 1, +deler.day, +deler.hour, +deler.minute);
  return new Date(somUtc - (osloSomUtc - somUtc));
}

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export function lagIcs(t: IcsTime, naa = new Date()): string {
  const start = osloTilUtc(t.tidspunkt);
  const slutt = new Date(start.getTime() + t.varighet_min * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Torget Tannklinikk demo//NO",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${t.bookingkode}@torget-demo`,
    `DTSTAMP:${utcStempel(naa)}`,
    `DTSTART:${utcStempel(start)}`,
    `DTEND:${utcStempel(slutt)}`,
    `SUMMARY:${escape(`Tannlege: ${t.behandling} (${t.behandler})`)}`,
    `LOCATION:${escape(t.adresse)}`,
    `DESCRIPTION:${escape(`Bookingkode: ${t.bookingkode}\nEndre eller avbestille: bruk chatten på nettsiden med koden og telefonnummeret, eller ring 12 34 56 78.`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT24H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Tannlegetime i morgen",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
