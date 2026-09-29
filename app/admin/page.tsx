import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  hentBookingerTilGjennomgang,
  hentHenvendelser,
} from "@/lib/kalender";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Henvendelser – demo",
};

const datoFormat = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formaterTid(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const deler = Object.fromEntries(
    datoFormat.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${deler.day}.${deler.month}.${deler.year} kl. ${deler.hour}:${deler.minute}`;
}

function storForbokstav(tekst: string): string {
  return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}

function Kommentar({ tekst }: { tekst?: string }) {
  if (!tekst) return <span className="text-daempet">–</span>;
  return (
    <p className="whitespace-pre-line rounded bg-oker-lys px-2 py-1.5 text-xs leading-relaxed">
      {tekst}
    </p>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection();

  const { nokkel } = await searchParams;
  const forventet = process.env.ADMIN_NOKKEL;
  const tillatt = forventet
    ? nokkel === forventet
    : process.env.NODE_ENV !== "production";
  if (!tillatt) notFound();

  const [henvendelserRaa, bestillinger] = await Promise.all([
    hentHenvendelser(),
    hentBookingerTilGjennomgang(),
  ]);
  const henvendelser = [...henvendelserRaa].sort(
    (a, b) => new Date(b.mottatt).getTime() - new Date(a.mottatt).getTime(),
  );
  const antallAktive = bestillinger.filter((b) => b.status === "aktiv").length;

  return (
    <div className="min-h-screen bg-papir pb-16 text-blekk">
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-8 sm:py-16">
        <h1 className="font-display text-4xl sm:text-5xl">
          Fra <span className="italic">assistenten</span>
        </h1>
        <p className="mt-3 text-sm text-daempet">
          Bestillinger og henvendelser samlet inn av den digitale assistenten.
          Demo – data slettes automatisk.
        </p>

        <section className="mt-12">
          <h2 className="font-display text-3xl sm:text-4xl">
            Bestillinger til <span className="italic">gjennomgang</span>
          </h2>
          <p className="mt-3 text-sm text-daempet">
            {antallAktive === 1
              ? "1 aktiv bestilling"
              : `${antallAktive} aktive bestillinger`}
          </p>

          {bestillinger.length === 0 ? (
            <p className="mt-10 border-t border-strek pt-6 text-blekk-myk">
              Ingen bestillinger ennå.
            </p>
          ) : (
            <>
              <table className="mt-10 hidden w-full border-t border-strek text-left text-sm md:table">
                <thead>
                  <tr className="border-b border-strek text-xs uppercase tracking-[0.12em] text-daempet">
                    <th className="py-3 pr-4 font-normal">Time</th>
                    <th className="py-3 pr-4 font-normal">Pasient</th>
                    <th className="py-3 pr-4 font-normal">
                      Hva gjelder timen?
                    </th>
                    <th className="py-3 pr-4 font-normal">Kode</th>
                    <th className="py-3 font-normal">Bestilt</th>
                  </tr>
                </thead>
                <tbody>
                  {bestillinger.map((b) =>
                    b.status === "avbestilt" ? (
                      <tr key={b.kode} className="border-b border-strek">
                        <td
                          colSpan={5}
                          className="py-3 text-daempet line-through"
                        >
                          {b.kode} – avbestilt
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={b.kode}
                        className="border-b border-strek align-top"
                      >
                        <td className="py-4 pr-4">
                          <p className="font-medium">
                            {storForbokstav(b.lesbar)}
                          </p>
                          <p className="mt-1 text-xs text-blekk-myk">
                            {b.behandling_navn} · {b.varighet_min} min ·{" "}
                            {b.behandler_navn}
                          </p>
                        </td>
                        <td className="break-words py-4 pr-4">
                          <p>{b.navn}</p>
                          <p className="mt-1 text-xs text-blekk-myk">
                            {b.telefon} · {b.epost}
                          </p>
                        </td>
                        <td className="py-4 pr-4">
                          <Kommentar tekst={b.kommentar} />
                        </td>
                        <td className="py-4 pr-4 font-mono text-xs">
                          {b.kode}
                        </td>
                        <td className="whitespace-nowrap py-4 text-blekk-myk">
                          {b.opprettet ? formaterTid(b.opprettet) : "–"}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>

              <ul className="mt-10 border-t border-strek md:hidden">
                {bestillinger.map((b) =>
                  b.status === "avbestilt" ? (
                    <li
                      key={b.kode}
                      className="border-b border-strek py-3 text-sm text-daempet line-through"
                    >
                      {b.kode} – avbestilt
                    </li>
                  ) : (
                    <li key={b.kode} className="border-b border-strek py-5">
                      <p className="font-medium">{storForbokstav(b.lesbar)}</p>
                      <p className="mt-1 text-xs text-blekk-myk">
                        {b.behandling_navn} · {b.varighet_min} min ·{" "}
                        {b.behandler_navn}
                      </p>
                      <p className="mt-3">{b.navn}</p>
                      <p className="break-words text-xs text-blekk-myk">
                        {b.telefon} · {b.epost}
                      </p>
                      <div className="mt-3">
                        <p className="mb-1 text-xs uppercase tracking-[0.12em] text-daempet">
                          Hva gjelder timen?
                        </p>
                        <Kommentar tekst={b.kommentar} />
                      </div>
                      <p className="mt-3 text-xs text-daempet">
                        <span className="font-mono">{b.kode}</span>
                        {b.opprettet
                          ? ` · Bestilt ${formaterTid(b.opprettet)}`
                          : ""}
                      </p>
                    </li>
                  ),
                )}
              </ul>
            </>
          )}
        </section>

        <h2 className="mt-16 font-display text-3xl sm:text-4xl">
          <span className="italic">Henvendelser</span>
        </h2>
        <p className="mt-3 text-sm text-daempet">
          {henvendelser.length === 1
            ? "1 henvendelse"
            : `${henvendelser.length} henvendelser`}
        </p>

        {henvendelser.length === 0 ? (
          <p className="mt-10 border-t border-strek pt-6 text-blekk-myk">
            Ingen henvendelser ennå.
          </p>
        ) : (
          <>
            <table className="mt-10 hidden w-full border-t border-strek text-left text-sm md:table">
              <thead>
                <tr className="border-b border-strek text-xs uppercase tracking-[0.12em] text-daempet">
                  <th className="w-48 py-3 pr-4 font-normal">Mottatt</th>
                  <th className="py-3 pr-4 font-normal">Oppsummering</th>
                  <th className="w-64 py-3 font-normal">Kontaktinfo</th>
                </tr>
              </thead>
              <tbody>
                {henvendelser.map((h) => (
                  <tr key={h.id} className="border-b border-strek align-top">
                    <td className="whitespace-nowrap py-4 pr-4 text-blekk-myk">
                      {formaterTid(h.mottatt)}
                    </td>
                    <td className="whitespace-pre-line py-4 pr-4 leading-relaxed">
                      {h.oppsummering}
                    </td>
                    <td className="break-words py-4">{h.kontaktinfo}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="mt-10 border-t border-strek md:hidden">
              {henvendelser.map((h) => (
                <li key={h.id} className="border-b border-strek py-5">
                  <p className="text-xs uppercase tracking-[0.12em] text-daempet">
                    {formaterTid(h.mottatt)}
                  </p>
                  <p className="mt-2 whitespace-pre-line leading-relaxed">
                    {h.oppsummering}
                  </p>
                  <p className="mt-3 break-words text-sm text-blekk-myk">
                    {h.kontaktinfo}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
