"use client";

import { useState } from "react";
import type { Booking, EpostStatus } from "@/components/Tidsvelger";
import { epostHtml } from "@/lib/epostmal";
import { lagIcs } from "@/lib/ics";

const STATUSTEKST: Record<EpostStatus, string> = {
  sendt: "Kvittering er sendt på e-post. Du får en ny e-post når klinikken har bekreftet timen.",
  forhandsvisning: "Demo: e-post sendes ikke herfra. Slik ser bekreftelsen ut:",
  feilet: "E-posten kunne ikke sendes, men timen er bestilt. Slik ser bekreftelsen ut:",
};

export default function Bekreftelseskort({ booking, epost }: { booking: Booking; epost: EpostStatus }) {
  const [visEpost, setVisEpost] = useState(false);

  function lastNedIcs() {
    const blob = new Blob([lagIcs(booking)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tannlegetime-${booking.bookingkode}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="anim-inn mt-2 overflow-hidden rounded-2xl border border-strek bg-kort">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-daempet">Bookingkode</p>
          <p className="font-display text-xl tracking-wide text-blekk">{booking.bookingkode}</p>
        </div>
        <button
          type="button"
          onClick={lastNedIcs}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-fjord/30 px-3 py-1.5 text-sm text-fjord transition-colors hover:border-fjord hover:bg-fjord-lys"
        >
          <Kalenderikon />
          Legg til i kalender
        </button>
      </div>
      <div className="border-t border-strek bg-papir/60 px-4 py-2.5 text-xs text-blekk-myk">
        {epost === "sendt" ? (
          STATUSTEKST.sendt
        ) : (
          <button type="button" onClick={() => setVisEpost((v) => !v)} className="text-left underline decoration-strek underline-offset-2 hover:text-blekk">
            {visEpost ? "Skjul e-posten" : STATUSTEKST[epost].replace(" Slik ser bekreftelsen ut:", " Se e-posten")}
          </button>
        )}
      </div>
      {visEpost && (
        <iframe
          title="Forhåndsvisning av bekreftelsesmail"
          srcDoc={epostHtml(booking)}
          sandbox=""
          className="h-[420px] w-full border-t border-strek bg-papir"
        />
      )}
    </div>
  );
}

function Kalenderikon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M8 8.5v3M6.5 10h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
