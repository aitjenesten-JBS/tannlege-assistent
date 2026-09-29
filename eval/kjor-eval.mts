// Kjører kontrollspørsmålene mot assistenten og sjekker svarene automatisk.
//
//   npm run eval                      kjør mot modellen (krever ANTHROPIC_API_KEY)
//   npm run eval -- --svar fil.json   rett ferdigskrevne svar ({ "1": "svartekst", ... })
//   npm run eval -- --nr 25,26        bare noen spørsmål
//   npm run eval -- --maks-usd 0.5    stopp når kjøringen har kostet så mye (standard 1.50)
//
// Skriver eval/resultat.md og eval/resultat.json.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { svar } from "@/lib/assistent";

interface Tilfelle {
  nr: number;
  kategori: string;
  sporsmal: string;
  klokke?: "apen" | "stengt";
  ma: string[];
  ikke?: string[];
  bor?: string[];
}

interface Resultat {
  nr: number;
  kategori: string;
  sporsmal: string;
  svar: string;
  ok: boolean;
  mangler: string[];
  forbudt: string[];
  bor_mangler: string[];
  tools: string[];
  kostnadUsd: number;
}

// Tirsdag 29.09.2026 kl. 10:00 (åpent) og kl. 22:00 (stengt), Oslo-tid.
const KLOKKE = { apen: new Date("2026-09-29T08:00:00Z"), stengt: new Date("2026-09-29T20:00:00Z") };

const args = process.argv.slice(2);
const flagg = (navn: string) => {
  const i = args.indexOf(navn);
  return i >= 0 ? args[i + 1] : undefined;
};

// JavaScripts \b regner ikke æøå som bokstaver. Bytt til en Unicode-bevisst ordgrense.
const ORDGRENSE = "(?:(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}]))";
const regex = (m: string) => new RegExp(m.replaceAll("\\b", ORDGRENSE), "iu");

const testsett: Tilfelle[] = readdirSync("eval")
  .filter((f) => /^testsett.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(`eval/${f}`, "utf8")) as Tilfelle[])
  .sort((a, b) => a.nr - b.nr);
const utvalg = flagg("--nr")?.split(",").map(Number);
const ferdigeSvar: Record<string, string> | null = flagg("--svar") ? JSON.parse(readFileSync(flagg("--svar")!, "utf8")) : null;
const tilfeller = testsett.filter((t) => !utvalg || utvalg.includes(t.nr));
const MAKS_USD = Number(flagg("--maks-usd") ?? 1.5);
let bruktUsd = 0;
let hoppetOver = 0;

const GRONN = "\x1b[32m";
const ROD = "\x1b[31m";
const GRA = "\x1b[90m";
const NULL = "\x1b[0m";

async function kjor(t: Tilfelle): Promise<Resultat> {
  let tekst: string;
  let tools: string[] = [];
  let kostnadUsd = 0;
  if (ferdigeSvar) {
    tekst = ferdigeSvar[String(t.nr)] ?? "";
  } else {
    const res = await svar(crypto.randomUUID(), t.sporsmal, KLOKKE[t.klokke ?? "apen"]);
    tekst = res.tekst;
    tools = res.toolKall.map((k) => k.navn);
    kostnadUsd = res.kostnadUsd;
    bruktUsd += kostnadUsd;
  }
  const mangler = t.ma.filter((m) => !regex(m).test(tekst));
  const forbudt = (t.ikke ?? []).filter((m) => regex(m).test(tekst));
  const bor_mangler = (t.bor ?? []).filter((m) => !regex(m).test(tekst));
  return { ...t, svar: tekst, ok: mangler.length === 0 && forbudt.length === 0, mangler, forbudt, bor_mangler, tools, kostnadUsd };
}

// Litt parallellitet, men ikke mer enn at rate limits holder.
const resultater: Resultat[] = [];
const ko = [...tilfeller];
await Promise.all(
  Array.from({ length: ferdigeSvar ? 1 : 3 }, async () => {
    while (ko.length) {
      const t = ko.shift()!;
      if (bruktUsd >= MAKS_USD) {
        hoppetOver++;
        continue;
      }
      try {
        resultater.push(await kjor(t));
      } catch (e) {
        resultater.push({ ...t, svar: `FEIL: ${e instanceof Error ? e.message : e}`, ok: false, mangler: ["(kjøring feilet)"], forbudt: [], bor_mangler: [], tools: [], kostnadUsd: 0 });
      }
    }
  }),
);
resultater.sort((a, b) => a.nr - b.nr);

// ---------- rapport ----------
const kategorier = [...new Set(resultater.map((r) => r.kategori))];
console.log("");
for (const r of resultater) {
  const merke = r.ok ? `${GRONN}✔${NULL}` : `${ROD}✖${NULL}`;
  console.log(`${merke} ${String(r.nr).padStart(2)}. ${r.sporsmal}`);
  if (!r.ok) {
    for (const m of r.mangler) console.log(`     ${ROD}mangler: ${m}${NULL}`);
    for (const m of r.forbudt) console.log(`     ${ROD}forbudt: ${m}${NULL}`);
    console.log(`     ${GRA}svar: ${r.svar.replace(/\s+/g, " ").slice(0, 220)}${NULL}`);
  }
  for (const m of r.bor_mangler) console.log(`     ${GRA}bør ha med: ${m}${NULL}`);
}
console.log("");
for (const k of kategorier) {
  const i = resultater.filter((r) => r.kategori === k);
  const ok = i.filter((r) => r.ok).length;
  console.log(`${ok === i.length ? GRONN : ROD}${k.padEnd(20)} ${ok}/${i.length}${NULL}`);
}
const totalt = resultater.filter((r) => r.ok).length;
console.log(`${"Totalt".padEnd(20)} ${totalt}/${resultater.length}`);
if (!ferdigeSvar) {
  const hoppet = hoppetOver ? `, ${ROD}${hoppetOver} spørsmål hoppet over pga. grensen${NULL}` : "";
  console.log(`Kostnad: ${bruktUsd.toFixed(3)} USD (grense ${MAKS_USD} USD)${hoppet}`);
}
console.log("");

const kilde = ferdigeSvar ? `ferdigskrevne svar (${flagg("--svar")})` : "claude-sonnet-5-5";
const md = [
  `# Evalresultat`,
  ``,
  `Kilde: ${kilde}. Kjørt ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.${ferdigeSvar ? "" : ` Kostnad: ${bruktUsd.toFixed(3)} USD.`}`,
  ``,
  `| Kategori | Bestått |`,
  `|---|---|`,
  ...kategorier.map((k) => {
    const i = resultater.filter((r) => r.kategori === k);
    return `| ${k} | ${i.filter((r) => r.ok).length}/${i.length} |`;
  }),
  `| **Totalt** | **${totalt}/${resultater.length}** |`,
  ``,
  `| # | Spørsmål | Resultat | Avvik |`,
  `|---|---|---|---|`,
  ...resultater.map(
    (r) =>
      `| ${r.nr} | ${r.sporsmal} | ${r.ok ? "🟢" : "🔴"} | ${[...r.mangler.map((m) => `mangler \`${m}\``), ...r.forbudt.map((m) => `forbudt \`${m}\``)].join("; ").replaceAll("|", "\\|")} |`,
  ),
  ``,
].join("\n");
writeFileSync("eval/resultat.md", md);
writeFileSync("eval/resultat.json", JSON.stringify(resultater, null, 2));
