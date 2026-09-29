"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dagtid } from "@/lib/kalender";
import type { Tidsvelger as Oppsett } from "@/lib/tools";
import { HELSE_SVAR, inneholderHelseopplysninger } from "@/lib/helse";
import { lesbarDato, lesbarTidspunkt, MANEDER } from "@/lib/tidsformat";

export interface Booking {
  bookingkode: string;
  behandling: string;
  behandler: string;
  tidspunkt: string;
  lesbar: string;
  varighet_min: number;
  navn: string;
  kommentar: string | null;
  adresse: string;
  gebyr_ikke_mott: string;
}

export type EpostStatus = "sendt" | "forhandsvisning" | "feilet";

interface Props {
  oppsett: Oppsett;
  samtaleId: string;
  onBooket: (booking: Booking, svar: string | null, epost: EpostStatus) => void;
  onFlyttValg: (tekst: string) => void;
}

const UKEDAGER_KORT = ["ma", "ti", "on", "to", "fr", "lø", "sø"];
const MAKS_MANEDER_FREM = 3;

const pad = (n: number) => String(n).padStart(2, "0");
const iDag = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const manedFra = (dato: string) => dato.slice(0, 7);
const flyttManed = (maned: string, delta: number) => {
  const [a, m] = maned.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const dagerIManed = (maned: string) => {
  const [a, m] = maned.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
};
const fornavn = (navn: string) => navn.split(" ")[0];

export default function Tidsvelger({ oppsett, samtaleId, onBooket, onFlyttValg }: Props) {
  const idag = iDag();
  const forsteManed = manedFra(oppsett.fra_dato && oppsett.fra_dato > idag ? oppsett.fra_dato : idag);
  const sisteManed = flyttManed(manedFra(idag), MAKS_MANEDER_FREM - 1);

  const [maned, setManed] = useState(forsteManed);
  const [dager, setDager] = useState<Record<string, Record<string, Dagtid[]>>>({});
  const [lasterFeil, setLasterFeil] = useState<string | null>(null);
  const [valgtDato, setValgtDato] = useState<string | null>(null);
  const [valgt, setValgt] = useState<Dagtid | null>(null);
  const [steg, setSteg] = useState<"velg" | "skjema" | "ferdig">("velg");
  const [skjema, setSkjema] = useState({ navn: "", telefon: "", epost: "", kommentar: "" });
  const helseIKommentar = inneholderHelseopplysninger(skjema.kommentar);
  const [sender, setSender] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [oppdater, setOppdater] = useState(0);
  const kortRef = useRef<HTMLDivElement>(null);
  const harRullet = useRef(false);

  const manedsdata = dager[maned];

  // Ruller bare chatlisten (scrollIntoView ville også rullet siden bak widgeten).
  function rull(til: "topp" | "bunn") {
    const kort = kortRef.current;
    const liste = kort?.closest<HTMLElement>("[data-rulleliste]");
    if (!kort || !liste) return;
    const bunn = kort.offsetTop + kort.offsetHeight + 12 - liste.clientHeight;
    const top = til === "topp" ? kort.offsetTop - 12 : bunn;
    if (til === "bunn" && liste.scrollTop >= bunn) return;
    liste.scrollTo({ top, behavior: "smooth" });
  }

  useEffect(() => {
    let avbrutt = false;
    const params = new URLSearchParams({
      behandling: oppsett.behandling,
      fra: `${maned}-01`,
      til: `${maned}-${pad(dagerIManed(maned))}`,
    });
    if (oppsett.behandler) params.set("behandler", oppsett.behandler);
    fetch(`/api/ledige?${params}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.feil ?? "Kunne ikke hente ledige tider.");
        return j.dager as Record<string, Dagtid[]>;
      })
      .then((d) => {
        if (avbrutt) return;
        setLasterFeil(null);
        setDager((f) => ({ ...f, [maned]: d }));
        if (!harRullet.current) {
          // Kortet vokser når tidene kommer: rull det i syne én gang, etter at det er tegnet.
          harRullet.current = true;
          requestAnimationFrame(() => rull("topp"));
        }
        // Velg første dag med ledige tider, så pasienten ser tider med en gang.
        setValgtDato((v) => (v && v.startsWith(maned) && d[v] ? v : (Object.keys(d).sort()[0] ?? null)));
      })
      .catch((e: Error) => !avbrutt && setLasterFeil(e.message));
    return () => {
      avbrutt = true;
    };
  }, [maned, oppsett.behandling, oppsett.behandler, oppdater]);

  const ruter = useMemo(() => {
    const [a, m] = maned.split("-").map(Number);
    const forsteUkedag = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7; // mandag = 0
    return [...Array(forsteUkedag).fill(null), ...Array.from({ length: dagerIManed(maned) }, (_, i) => `${maned}-${pad(i + 1)}`)];
  }, [maned]);

  const tider = (valgtDato && manedsdata?.[valgtDato]) || [];
  const [aar, mnd] = maned.split("-").map(Number);

  async function bestill(e: React.FormEvent) {
    e.preventDefault();
    if (!valgt) return;
    setSender(true);
    setFeil(null);
    try {
      const r = await fetch("/api/bestill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          samtaleId,
          behandling: oppsett.behandling,
          tidspunkt: valgt.tidspunkt,
          behandler: valgt.behandler_id,
          ...skjema,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setFeil(j.feil ?? "Noe gikk galt. Prøv igjen.");
        if (r.status === 409 && /ikke ledig/i.test(j.feil ?? "")) {
          // Tiden ble tatt i mellomtiden: tilbake til kalenderen med ferske tider.
          setValgt(null);
          setSteg("velg");
          setOppdater((n) => n + 1);
        }
        return;
      }
      setSteg("ferdig");
      onBooket(j.booking as Booking, j.svar as string | null, (j.epost ?? "forhandsvisning") as EpostStatus);
    } catch {
      setFeil("Fikk ikke kontakt. Sjekk nettet og prøv igjen.");
    } finally {
      setSender(false);
    }
  }

  if (steg === "ferdig" && valgt) {
    return (
      <div className="anim-inn mt-2 flex items-center gap-2 rounded-xl border border-strek bg-kort px-3 py-2 text-sm text-blekk-myk">
        <Hake /> Bestilt: {lesbarTidspunkt(valgt.tidspunkt)}
      </div>
    );
  }

  return (
    <div ref={kortRef} className="anim-inn mt-2 overflow-hidden rounded-2xl border border-strek bg-kort shadow-[0_1px_0_rgba(16,48,47,0.04)]">
      <div className="flex items-baseline justify-between gap-2 border-b border-strek px-4 pb-2.5 pt-3">
        <p className="font-display text-lg leading-tight text-blekk">
          {oppsett.formaal === "flytte" ? "Velg ny tid" : "Velg tid"}
        </p>
        <p className="text-xs text-daempet">
          {oppsett.behandling_navn} · {oppsett.varighet_min} min
        </p>
      </div>

      {steg === "velg" && (
        <>
          <div className="px-3 pt-2">
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => setManed(flyttManed(maned, -1))}
                disabled={maned <= manedFra(idag)}
                aria-label="Forrige måned"
                className="grid size-8 place-items-center rounded-full text-blekk hover:bg-papir-dyp disabled:opacity-25"
              >
                <Pil retning="venstre" />
              </button>
              <p className="text-sm font-medium capitalize text-blekk">
                {MANEDER[mnd - 1]} {aar}
              </p>
              <button
                type="button"
                onClick={() => setManed(flyttManed(maned, 1))}
                disabled={maned >= sisteManed}
                aria-label="Neste måned"
                className="grid size-8 place-items-center rounded-full text-blekk hover:bg-papir-dyp disabled:opacity-25"
              >
                <Pil retning="hoyre" />
              </button>
            </div>

            <div className="mt-1 grid grid-cols-7 text-center text-[11px] uppercase tracking-wide text-daempet">
              {UKEDAGER_KORT.map((d) => (
                <span key={d} className="py-1">{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center" role="grid" aria-label="Velg dag">
              {ruter.map((dato, i) => {
                if (!dato) return <span key={`tom-${i}`} />;
                const harTider = Boolean(manedsdata?.[dato]);
                const erValgt = dato === valgtDato;
                return (
                  <button
                    key={dato}
                    type="button"
                    disabled={!harTider}
                    onClick={() => {
                      setValgtDato(dato);
                      setValgt(null);
                    }}
                    aria-pressed={erValgt}
                    aria-label={`${lesbarDato(dato)}${harTider ? "" : ", ingen ledige tider"}`}
                    className={`relative mx-auto grid size-9 place-items-center rounded-full text-sm transition-colors ${
                      erValgt
                        ? "bg-blekk font-medium text-papir"
                        : harTider
                          ? "font-medium text-blekk hover:bg-fjord-lys"
                          : "text-daempet/40"
                    } ${dato === idag && !erValgt ? "ring-1 ring-strek" : ""}`}
                  >
                    {Number(dato.slice(8))}
                    {harTider && !erValgt && <span className="absolute bottom-1 size-1 rounded-full bg-oker" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 border-t border-strek px-3 py-3">
            {lasterFeil ? (
              <p className="text-sm text-feil">{lasterFeil}</p>
            ) : !manedsdata ? (
              <p className="text-sm text-daempet">Henter ledige tider …</p>
            ) : !valgtDato ? (
              <p className="text-sm text-daempet">Ingen ledige tider denne måneden. Prøv neste måned.</p>
            ) : (
              <>
                <p className="mb-2 text-xs font-medium first-letter:uppercase text-blekk-myk">{lesbarDato(valgtDato)}</p>
                <div className="grid max-h-44 grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
                  {tider.map((t) => {
                    const erValgt = valgt?.tidspunkt === t.tidspunkt;
                    return (
                      <button
                        key={t.tidspunkt}
                        type="button"
                        onClick={() => {
                          setValgt(t);
                          requestAnimationFrame(() => rull("bunn"));
                        }}
                        aria-pressed={erValgt}
                        aria-label={`${t.tid} hos ${t.behandler_navn}`}
                        className={`rounded-lg border px-1 py-1.5 text-center transition-colors ${
                          erValgt
                            ? "border-fjord bg-fjord text-papir"
                            : "border-strek bg-kort text-blekk hover:border-fjord hover:bg-fjord-lys"
                        }`}
                      >
                        <span className="block text-sm font-medium tabular-nums">{t.tid}</span>
                        <span className={`block truncate text-[11px] ${erValgt ? "text-papir/80" : "text-daempet"}`}>
                          {fornavn(t.behandler_navn)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-strek bg-papir/60 px-4 py-2.5">
            <p className="min-w-0 text-xs text-blekk-myk" aria-live="polite">
              {valgt ? (
                <span className="flex items-center gap-1.5">
                  <Hake />
                  <span className="truncate">
                    {lesbarTidspunkt(valgt.tidspunkt)} · {fornavn(valgt.behandler_navn)}
                  </span>
                </span>
              ) : (
                "Velg dag og klokkeslett"
              )}
            </p>
            <button
              type="button"
              disabled={!valgt}
              onClick={() =>
                oppsett.formaal === "flytte"
                  ? (setSteg("ferdig"),
                    onFlyttValg(`Jeg vil flytte timen til ${lesbarTidspunkt(valgt!.tidspunkt)} hos ${valgt!.behandler_navn}.`))
                  : (setSteg("skjema"), requestAnimationFrame(() => rull("topp")))
              }
              className="shrink-0 rounded-full bg-blekk px-4 py-2 text-sm font-medium text-papir transition-opacity hover:bg-blekk-myk disabled:opacity-30"
            >
              {oppsett.formaal === "flytte" ? "Flytt hit" : "Fortsett"}
            </button>
          </div>
        </>
      )}

      {steg === "skjema" && valgt && (
        <form onSubmit={bestill} className="space-y-3 px-4 py-3">
          <div className="rounded-lg bg-fjord-lys px-3 py-2 text-sm text-blekk">
            <span className="first-letter:uppercase">{lesbarTidspunkt(valgt.tidspunkt)}</span>
            <span className="block text-xs text-blekk-myk">
              hos {valgt.behandler_navn} · {oppsett.varighet_min} min
            </span>
          </div>
          <Felt etikett="Fullt navn" autoComplete="name" verdi={skjema.navn} onEndre={(v) => setSkjema({ ...skjema, navn: v })} />
          <Felt
            etikett="Telefon"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            verdi={skjema.telefon}
            onEndre={(v) => setSkjema({ ...skjema, telefon: v })}
            monster="^(\+47|0047)?\s*[2-9](\s*\d){7}$"
            hint="8 siffer"
          />
          <Felt etikett="E-post" type="email" autoComplete="email" verdi={skjema.epost} onEndre={(v) => setSkjema({ ...skjema, epost: v })} />
          <label className="block">
            <span className="mb-1 flex justify-between text-xs font-medium text-blekk-myk">
              Hva gjelder timen?
              <span className="font-normal text-daempet">valgfritt</span>
            </span>
            <textarea
              rows={2}
              maxLength={200}
              value={skjema.kommentar}
              onChange={(e) => setSkjema({ ...skjema, kommentar: e.target.value })}
              placeholder="F.eks. «undersøkelse» eller «første gang hos dere»"
              aria-describedby="kommentar-hjelp"
              aria-invalid={helseIKommentar}
              className={`w-full resize-none rounded-lg border bg-kort px-3 py-2 text-[15px] text-blekk outline-none transition-colors placeholder:text-daempet/70 focus:ring-2 ${
                helseIKommentar ? "border-feil focus:ring-feil/15" : "border-strek focus:border-fjord focus:ring-fjord/15"
              }`}
            />
          </label>
          {helseIKommentar ? (
            <p id="kommentar-hjelp" role="alert" className="rounded-lg bg-feil-lys px-3 py-2 text-[13px] leading-snug text-feil">
              {HELSE_SVAR} Fjern det fra feltet for å bestille.
            </p>
          ) : (
            <p id="kommentar-hjelp" className="text-[11px] leading-snug text-daempet">
              Klinikken går gjennom bestillingen. Skriv ikke symptomer, sykdommer eller medisiner her.
            </p>
          )}
          {feil && <p className="rounded-lg bg-feil-lys px-3 py-2 text-sm text-feil">{feil}</p>}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setSteg("velg");
                setFeil(null);
              }}
              className="rounded-full px-3 py-2 text-sm text-blekk-myk hover:bg-papir-dyp"
            >
              Tilbake
            </button>
            <button
              type="submit"
              disabled={sender || helseIKommentar}
              className="rounded-full bg-blekk px-5 py-2 text-sm font-medium text-papir hover:bg-blekk-myk disabled:opacity-50"
            >
              {sender ? "Bestiller …" : "Bestill time"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Felt(props: {
  etikett: string;
  verdi: string;
  onEndre: (v: string) => void;
  type?: string;
  inputMode?: "tel" | "email" | "text";
  autoComplete?: string;
  monster?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs font-medium text-blekk-myk">
        {props.etikett}
        {props.hint && <span className="font-normal text-daempet">{props.hint}</span>}
      </span>
      <input
        required
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        pattern={props.monster}
        maxLength={props.type === "email" ? 200 : 100}
        value={props.verdi}
        onChange={(e) => props.onEndre(e.target.value)}
        className="w-full rounded-lg border border-strek bg-kort px-3 py-2 text-[15px] text-blekk outline-none transition-colors placeholder:text-daempet focus:border-fjord focus:ring-2 focus:ring-fjord/15"
      />
    </label>
  );
}

function Hake() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-fjord" aria-hidden>
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Pil({ retning }: { retning: "venstre" | "hoyre" }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <path
        d={retning === "venstre" ? "M10 3.5L5.5 8 10 12.5" : "M6 3.5L10.5 8 6 12.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
