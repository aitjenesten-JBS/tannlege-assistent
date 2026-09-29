import { naaOslo } from "@/lib/kalender";
import { hentLager } from "@/lib/lagring";

// Kostnadsvern for demoen: registrerer faktisk tokenbruk per kall og stopper chatten når
// dagstaket eller totaltaket er nådd. Lagres i Redis i produksjon, i minnet lokalt.

// USD per million tokens for claude-sonnet-5-5 (5-minutters cache-skriving).
const PRIS = { input: 2, cacheSkriv: 2.5, cacheLes: 0.2, output: 10 };

export interface Forbruk {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export class BudsjettOppbrukt extends Error {}

export function kostnadUsd(u: Forbruk): number {
  return (
    (u.input_tokens * PRIS.input +
      (u.cache_creation_input_tokens ?? 0) * PRIS.cacheSkriv +
      (u.cache_read_input_tokens ?? 0) * PRIS.cacheLes +
      u.output_tokens * PRIS.output) /
    1_000_000
  );
}

const grense = (navn: string, standard: number) => {
  const v = Number(process.env[navn]);
  return Number.isFinite(v) && v > 0 ? v : standard;
};
const dagNokkel = () => `kostnad:dag:${naaOslo().dato}`;

export async function registrerForbruk(u: Forbruk): Promise<number> {
  const usd = kostnadUsd(u);
  const lager = hentLager();
  const [dag, totalt] = await Promise.all([lager.hent<number>(dagNokkel()), lager.hent<number>("kostnad:totalt")]);
  await Promise.all([
    lager.lagre(dagNokkel(), (dag ?? 0) + usd, 3 * 24 * 3600),
    lager.lagre("kostnad:totalt", (totalt ?? 0) + usd),
  ]);
  return usd;
}

export async function sjekkBudsjett(): Promise<void> {
  const lager = hentLager();
  const [dag, totalt] = await Promise.all([lager.hent<number>(dagNokkel()), lager.hent<number>("kostnad:totalt")]);
  if ((dag ?? 0) >= grense("DAGSBUDSJETT_USD", 1) || (totalt ?? 0) >= grense("TOTALBUDSJETT_USD", 8)) {
    throw new BudsjettOppbrukt("Kostnadstaket for demoen er nådd.");
  }
}

export async function hentForbruk() {
  const lager = hentLager();
  const [dag, totalt] = await Promise.all([lager.hent<number>(dagNokkel()), lager.hent<number>("kostnad:totalt")]);
  return { dag: dag ?? 0, totalt: totalt ?? 0, dagsgrense: grense("DAGSBUDSJETT_USD", 1), totalgrense: grense("TOTALBUDSJETT_USD", 8) };
}
