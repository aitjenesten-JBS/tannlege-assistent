import Widget from "@/components/Widget";
import klinikk from "@/data/klinikk.json";
import ansatte from "@/data/ansatte.json";
import priser from "@/data/priser.json";

const UTVALGTE_PRISER = [
  "undersokelse",
  "fylling_1_flate",
  "rotfylling_1_kanal",
  "trekking",
  "krone_jeksel",
  "etterkontroll",
];

const DAGER: { nokkel: keyof typeof klinikk.apningstider; navn: string }[] = [
  { nokkel: "mandag", navn: "Mandag" },
  { nokkel: "tirsdag", navn: "Tirsdag" },
  { nokkel: "onsdag", navn: "Onsdag" },
  { nokkel: "torsdag", navn: "Torsdag" },
  { nokkel: "fredag", navn: "Fredag" },
  { nokkel: "lordag", navn: "Lørdag" },
  { nokkel: "sondag", navn: "Søndag" },
];

const kroner = new Intl.NumberFormat("nb-NO");

function formaterPris(pris: number | null): string {
  return pris === null ? "Etter avtale" : `${kroner.format(pris)} kr`;
}

function stor(tekst: string): string {
  return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}

const tlfHref = `tel:+47${klinikk.telefon.replace(/\s/g, "")}`;

export default function Home() {
  const valgtePriser = UTVALGTE_PRISER.map((id) =>
    priser.find((p) => p.id === id),
  ).filter((p): p is (typeof priser)[number] => p !== undefined);
  const behandlere = ansatte.filter((a) => a.bookbar);
  const adr = klinikk.adresse;

  return (
    <div className="min-h-screen bg-papir pb-28 text-blekk">
      <div className="border-b border-strek">
        <p className="mx-auto max-w-5xl px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-daempet sm:px-8">
          Demo · ikke klinikkens offisielle nettside
        </p>
      </div>

      <main className="mx-auto max-w-5xl px-4 sm:px-8">
        <section className="py-14 sm:py-24">
          <h1 className="font-display text-5xl leading-[1.02] sm:text-7xl">
            {klinikk.navn}
          </h1>
          <p className="mt-4 text-blekk-myk">
            Tidligere {klinikk.tidligere_navn.join(", ")}
          </p>
          <p className="mt-1 text-blekk-myk">
            {adr.gate}, {adr.etasje}, {adr.postnummer} {adr.sted}
            {" · "}
            <a
              href={tlfHref}
              className="text-fjord underline underline-offset-4"
            >
              {klinikk.telefon}
            </a>
          </p>
          <p className="mt-8 max-w-xl text-lg leading-relaxed">
            Still spørsmål eller bestill time når det passer deg – assistenten
            nede i hjørnet svarer døgnet rundt.
          </p>
          {klinikk.tar_imot_nye_pasienter && (
            <p className="mt-6 inline-block bg-fjord-lys px-3 py-1 text-sm text-fjord">
              Tar imot nye pasienter
            </p>
          )}
        </section>

        <section className="grid border-t border-strek md:grid-cols-3">
          <div className="border-b border-strek py-8 md:border-b-0 md:border-r md:pr-8">
            <h2 className="font-display text-2xl">Åpningstider</h2>
            <dl className="mt-4 space-y-1.5 text-sm">
              {DAGER.map(({ nokkel, navn }) => {
                const tid = klinikk.apningstider[nokkel];
                return (
                  <div key={nokkel} className="flex justify-between gap-4">
                    <dt className="text-blekk-myk">{navn}</dt>
                    <dd className={tid ? "" : "text-daempet"}>
                      {tid ? `${tid.fra}–${tid.til}` : "Stengt"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>

          <div className="border-b border-strek py-8 md:border-b-0 md:border-r md:px-8">
            <h2 className="font-display text-2xl">Finn oss</h2>
            <p className="mt-4 text-sm leading-relaxed">
              {adr.gate}
              <br />
              {adr.etasje}, {adr.beskrivelse}
              <br />
              {adr.postnummer} {adr.sted}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-blekk-myk">
              Parkering: {klinikk.parkering.steder.join(", ")}.{" "}
              {klinikk.parkering.merknad}.
            </p>
          </div>

          <div className="py-8 md:pl-8">
            <h2 className="font-display text-2xl">Kontakt</h2>
            <p className="mt-4 text-sm text-blekk-myk">Telefon</p>
            <a
              href={tlfHref}
              className="text-lg text-fjord underline underline-offset-4"
            >
              {klinikk.telefon}
            </a>
          </div>
        </section>

        <section className="border-t border-strek py-12 sm:py-16">
          <h2 className="font-display text-3xl sm:text-4xl">
            Utvalgte <span className="italic">priser</span>
          </h2>
          <ul className="mt-8 grid gap-x-16 md:grid-cols-2">
            {valgtePriser.map((p) => (
              <li
                key={p.id}
                className="flex items-baseline justify-between gap-4 border-b border-strek py-3"
              >
                <span>{p.navn}</span>
                <span className="whitespace-nowrap tabular-nums">
                  {formaterPris(p.pris_kr)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-daempet">
            Fullstendig prisliste får du hos klinikken eller ved å spørre
            assistenten.
          </p>
        </section>

        <section className="border-t border-strek py-12 sm:py-16">
          <h2 className="font-display text-3xl sm:text-4xl">Behandlere</h2>
          <ul className="mt-8 grid gap-x-16 md:grid-cols-2">
            {behandlere.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline justify-between gap-4 border-b border-strek py-3"
              >
                <span>{a.navn}</span>
                <span className="text-sm text-daempet">{stor(a.rolle)}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl border-t border-strek px-4 py-6 sm:px-8">
        <p className="text-xs text-daempet">
          Porteføljeprosjekt. Priser og informasjon hentet fra klinikkens
          nettside, september 2026.
        </p>
      </footer>
      <Widget />
    </div>
  );
}
