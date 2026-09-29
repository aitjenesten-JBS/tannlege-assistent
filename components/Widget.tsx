"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Tidsvelger as TidsvelgerOppsett } from "@/lib/tools";
import Bekreftelseskort from "@/components/Bekreftelseskort";
import Tidsvelger, { type Booking, type EpostStatus } from "@/components/Tidsvelger";

interface Melding {
  id: string;
  rolle: "bruker" | "assistent" | "feil";
  tekst: string;
  tidsvelger?: TidsvelgerOppsett | null;
  booking?: { data: Booking; epost: EpostStatus };
  frakoblet?: boolean;
}

const LAGRING = "torget-chat-v1";
const TELEFON = "12 34 56 78";

const VELKOMST: Melding = {
  id: "velkomst",
  rolle: "assistent",
  tekst:
    "Hei! Jeg er den digitale assistenten til Torget Tannklinikk (tidligere Tannlegene Holm). Jeg kan svare på spørsmål om priser, åpningstider og behandlinger, og hjelpe deg å bestille, flytte eller avbestille time.",
};

const HURTIGVALG = [
  { etikett: "Bestill time", tekst: "Jeg vil bestille time." },
  { etikett: "Priser", tekst: "Hva koster en undersøkelse, og hva er de vanligste prisene?" },
  { etikett: "Avbestill", tekst: "Jeg vil avbestille timen min." },
];

const nyId = () => crypto.randomUUID();

interface Lagret {
  samtaleId: string;
  meldinger: Melding[];
  ferdigeVelgere: string[];
}

// Samtalen overlever sideskift og reload i samme fane, ikke mer. Leses i lazy init: panelet er
// lukket ved første render, så markupen avhenger ikke av den og gir ikke hydreringsavvik.
function lesLagret(): Lagret | null {
  if (typeof window === "undefined") return null;
  try {
    const l = JSON.parse(sessionStorage.getItem(LAGRING) ?? "null");
    return l?.samtaleId && Array.isArray(l.meldinger) ? { ferdigeVelgere: [], ...l } : null;
  } catch {
    return null;
  }
}

export default function Widget() {
  const [apen, setApen] = useState(false);
  const [lagret] = useState(lesLagret);
  const [samtaleId, setSamtaleId] = useState<string | null>(() => lagret?.samtaleId ?? (typeof window === "undefined" ? null : nyId()));
  const [meldinger, setMeldinger] = useState<Melding[]>(() => lagret?.meldinger ?? [VELKOMST]);
  const [utkast, setUtkast] = useState("");
  const [venter, setVenter] = useState(false);
  const [ferdigeVelgere, setFerdigeVelgere] = useState<string[]>(() => lagret?.ferdigeVelgere ?? []);
  const listeRef = useRef<HTMLDivElement>(null);
  const feltRef = useRef<HTMLTextAreaElement>(null);
  const knappRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!samtaleId) return;
    try {
      sessionStorage.setItem(LAGRING, JSON.stringify({ samtaleId, meldinger, ferdigeVelgere }));
    } catch {
      // privat modus o.l.
    }
  }, [samtaleId, meldinger, ferdigeVelgere]);

  useEffect(() => {
    listeRef.current?.scrollTo({ top: listeRef.current.scrollHeight, behavior: "smooth" });
  }, [meldinger, venter, apen]);

  useEffect(() => {
    if (apen) feltRef.current?.focus();
  }, [apen]);

  const lukk = useCallback(() => {
    setApen(false);
    knappRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!apen) return;
    const vedTast = (e: KeyboardEvent) => e.key === "Escape" && lukk();
    window.addEventListener("keydown", vedTast);
    return () => window.removeEventListener("keydown", vedTast);
  }, [apen, lukk]);

  const leggTil = (m: Omit<Melding, "id">) => setMeldinger((f) => [...f, { ...m, id: nyId() }]);

  const send = useCallback(
    async (tekst: string) => {
      const melding = tekst.trim();
      if (!melding || venter || !samtaleId) return;
      setUtkast("");
      leggTil({ rolle: "bruker", tekst: melding });
      setVenter(true);
      try {
        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ samtaleId, melding }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) leggTil({ rolle: "feil", tekst: j.feil ?? `Noe gikk galt. Ring klinikken på ${TELEFON}.` });
        else leggTil({ rolle: "assistent", tekst: j.svar, tidsvelger: j.tidsvelger, frakoblet: j.frakoblet });
      } catch {
        leggTil({ rolle: "feil", tekst: "Fikk ikke kontakt. Sjekk nettet og prøv igjen." });
      } finally {
        setVenter(false);
      }
    },
    [samtaleId, venter],
  );

  function vedBooking(melding: Melding, booking: Booking, svar: string | null, epost: EpostStatus) {
    setFerdigeVelgere((f) => [...f, melding.id]);
    leggTil({ rolle: "bruker", tekst: `Bestill ${booking.lesbar} hos ${booking.behandler}` });
    leggTil({
      rolle: "assistent",
      // Uten svar fra modellen (f.eks. utilgjengelig) viser vi bekreftelsen fra timeboken selv.
      tekst:
        svar ??
        `Timen er bestilt: ${booking.behandling.toLowerCase()} ${booking.lesbar} hos ${booking.behandler}, ${booking.adresse}. Klinikken går gjennom bestillingen.\n\nDu trenger bookingkoden og telefonnummeret for å endre timen. ${booking.gebyr_ikke_mott}.`,
      booking: { data: booking, epost },
    });
  }

  function nySamtale() {
    setSamtaleId(nyId());
    setMeldinger([VELKOMST]);
    setFerdigeVelgere([]);
    feltRef.current?.focus();
  }

  // Bare den siste tidsvelgeren er aktiv. Eldre forsvinner når samtalen går videre.
  const sisteVelger = [...meldinger].reverse().find((m) => m.tidsvelger)?.id;

  return (
    <>
      {!apen && (
        <button
          ref={knappRef}
          type="button"
          onClick={() => setApen(true)}
          className="anim-inn fixed bottom-4 right-4 z-50 flex h-14 items-center gap-2.5 rounded-full bg-blekk pl-4 pr-5 text-papir shadow-[0_10px_30px_-10px_rgba(16,48,47,0.6)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-oker/60 sm:bottom-6 sm:right-6"
          aria-label="Åpne chat med den digitale assistenten"
        >
          <Snakkeboble />
          <span className="text-[15px] font-medium">Bestill eller spør</span>
        </button>
      )}

      {apen && (
        <section
          role="dialog"
          aria-label="Chat med Torget Tannklinikk"
          className="anim-panel fixed inset-0 z-50 flex flex-col overflow-hidden bg-papir sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(700px,calc(100dvh-3rem))] sm:w-[400px] sm:rounded-3xl sm:border sm:border-strek sm:shadow-[0_24px_60px_-20px_rgba(16,48,47,0.45)]"
        >
          <header className="relative flex items-center gap-3 bg-blekk px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-papir">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-papir/10 font-display text-xl italic">S</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-display text-[17px] leading-tight sm:text-[19px]">
                  Torget<span className="hidden min-[400px]:inline"> Tannhelsesenter</span>
                </h2>
                <span className="shrink-0 rounded-full bg-oker px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blekk">
                  Demo
                </span>
              </div>
              <p className="truncate text-xs text-papir/70">
                Digital assistent<span className="hidden min-[400px]:inline"> · svarer døgnet rundt</span>
              </p>
            </div>
            <button
              type="button"
              onClick={nySamtale}
              className="rounded-full px-2 py-1 text-xs text-papir/70 hover:bg-papir/10 hover:text-papir"
              title="Start en ny samtale"
            >
              Ny
            </button>
            <button
              type="button"
              onClick={lukk}
              aria-label="Lukk chat"
              className="grid size-9 place-items-center rounded-full hover:bg-papir/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oker"
            >
              <Kryss />
            </button>
          </header>

          <div ref={listeRef} data-rulleliste className="relative flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {meldinger.map((m) => (
              <Fragment key={m.id}>
                <Boble melding={m} />
                {m.booking && <Bekreftelseskort booking={m.booking.data} epost={m.booking.epost} />}
                {m.tidsvelger && samtaleId && (m.id === sisteVelger || ferdigeVelgere.includes(m.id)) && (
                  <div className="pl-0 pr-2">
                    {ferdigeVelgere.includes(m.id) ? null : (
                      <Tidsvelger
                        oppsett={m.tidsvelger}
                        samtaleId={samtaleId}
                        onBooket={(b, s, e) => vedBooking(m, b, s, e)}
                        onFlyttValg={(tekst) => {
                          setFerdigeVelgere((f) => [...f, m.id]);
                          send(tekst);
                        }}
                      />
                    )}
                  </div>
                )}
              </Fragment>
            ))}

            {meldinger.length === 1 && (
              <div className="anim-inn flex flex-wrap gap-2 pt-1" style={{ animationDelay: "120ms" }}>
                {HURTIGVALG.map((h) => (
                  <button
                    key={h.etikett}
                    type="button"
                    onClick={() => send(h.tekst)}
                    className="rounded-full border border-fjord/30 bg-kort px-3.5 py-1.5 text-sm text-fjord transition-colors hover:border-fjord hover:bg-fjord-lys"
                  >
                    {h.etikett}
                  </button>
                ))}
              </div>
            )}

            {venter && (
              <div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-strek bg-kort px-4 py-3" aria-label="Assistenten skriver">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="anim-prikk size-1.5 rounded-full bg-fjord" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(utkast);
            }}
            className="border-t border-strek bg-kort px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-strek bg-papir px-3 py-1.5 focus-within:border-fjord focus-within:ring-2 focus-within:ring-fjord/15">
              <label htmlFor="chat-felt" className="sr-only">Skriv en melding</label>
              <textarea
                id="chat-felt"
                ref={feltRef}
                rows={1}
                maxLength={1000}
                value={utkast}
                onChange={(e) => {
                  setUtkast(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(utkast);
                  }
                }}
                placeholder="Skriv en melding …"
                className="max-h-28 flex-1 resize-none bg-transparent py-1.5 text-[15px] text-blekk outline-none placeholder:text-daempet"
              />
              <button
                type="submit"
                disabled={!utkast.trim() || venter}
                aria-label="Send"
                className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-blekk text-papir transition-opacity disabled:opacity-25"
              >
                <SendPil />
              </button>
            </div>
            <p className="mt-2 px-1 text-center text-[11px] leading-snug text-daempet">
              AI-assistent, kan ta feil. Ved pustevansker eller rask hevelse: ring 113.
            </p>
          </form>
        </section>
      )}
    </>
  );
}

function Boble({ melding }: { melding: Melding }) {
  if (melding.rolle === "bruker") {
    return (
      <div className="anim-inn ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-blekk px-3.5 py-2.5 text-[15px] leading-relaxed text-papir">
        {melding.tekst}
      </div>
    );
  }
  if (melding.rolle === "feil") {
    return (
      <div role="alert" className="anim-inn w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-feil-lys px-3.5 py-2.5 text-[15px] leading-relaxed text-feil">
        {melding.tekst}
      </div>
    );
  }
  return (
    <div className="anim-inn w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-strek bg-kort px-3.5 py-2.5 text-[15px] leading-relaxed text-blekk">
      <Tekst tekst={melding.tekst} />
      {melding.frakoblet && (
        <p className="mt-2 border-t border-dashed border-strek pt-1.5 text-[11px] text-daempet">Skriptet svar – AI er av (frakoblet demo)</p>
      )}
    </div>
  );
}

/** Enkel, trygg visning av modellens svar: avsnitt, punktlister og **fet** tekst. Ingen HTML. */
function Tekst({ tekst }: { tekst: string }) {
  const blokker = tekst.trim().split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blokker.map((blokk, i) => {
        const linjer = blokk.split("\n");
        if (linjer.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i} className="space-y-1">
              {linjer.map((l, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-oker" />
                  <span>{fet(l.replace(/^\s*[-*•]\s+/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {fet(blokk)}
          </p>
        );
      })}
    </div>
  );
}

function fet(tekst: string) {
  return tekst.split(/(\*\*[^*]+\*\*)/g).map((del, i) =>
    del.startsWith("**") && del.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {del.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{del}</Fragment>
    ),
  );
}

function Snakkeboble() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        d="M5 5.5h14a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5h-7.2L8 19.8v-3.3H5A1.5 1.5 0 013.5 15V7A1.5 1.5 0 015 5.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="11" r="1" fill="currentColor" />
      <circle cx="12" cy="11" r="1" fill="currentColor" />
      <circle cx="15.5" cy="11" r="1" fill="currentColor" />
    </svg>
  );
}

function Kryss() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SendPil() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <path d="M8 13V3.5M3.8 7.5L8 3.3l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
