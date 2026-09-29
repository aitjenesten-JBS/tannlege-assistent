// Rene hjelpere for norske datoer. Brukes både på serveren og i widgeten (ingen avhengigheter).

export const UKEDAGER = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
export const MANEDER = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

const utc = (dato: string) => new Date(`${dato}T00:00:00Z`);

/** "2026-10-06" → "tirsdag 6. oktober" */
export function lesbarDato(dato: string): string {
  const d = utc(dato);
  return `${UKEDAGER[d.getUTCDay()]} ${d.getUTCDate()}. ${MANEDER[d.getUTCMonth()]}`;
}

/** "2026-10-06T10:30" → "tirsdag 6. oktober kl. 10:30" */
export function lesbarTidspunkt(tidspunkt: string): string {
  const [dato, tid] = tidspunkt.split("T");
  return `${lesbarDato(dato)} kl. ${tid}`;
}
