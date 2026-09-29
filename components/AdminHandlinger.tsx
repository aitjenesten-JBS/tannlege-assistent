"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Handling = "bekreft" | "avvis";

export default function AdminHandlinger({
  kode,
  nokkel,
}: {
  kode: string;
  nokkel: string | null;
}) {
  const router = useRouter();
  const [venter, setVenter] = useState<Handling | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  async function utfor(handling: Handling) {
    if (
      handling === "avvis" &&
      !window.confirm(
        "Avvise bestillingen? Tiden frigis, og pasienten får beskjed.",
      )
    ) {
      return;
    }
    setVenter(handling);
    setFeil(null);
    try {
      const svar = await fetch("/api/admin/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          nokkel ? { kode, handling, nokkel } : { kode, handling },
        ),
      });
      const data: { feil?: string } | null = await svar
        .json()
        .catch(() => null);
      if (!svar.ok) {
        setFeil(data?.feil ?? "Noe gikk galt. Prøv igjen.");
        return;
      }
      router.refresh();
    } catch {
      setFeil("Kunne ikke nå serveren. Prøv igjen.");
    } finally {
      setVenter(null);
    }
  }

  const opptatt = venter !== null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={opptatt}
          onClick={() => utfor("bekreft")}
          className="rounded-full bg-blekk px-4 py-1.5 text-xs text-papir disabled:opacity-50"
        >
          {venter === "bekreft" ? "…" : "Bekreft"}
        </button>
        <button
          type="button"
          disabled={opptatt}
          onClick={() => utfor("avvis")}
          className="rounded-full border border-strek px-4 py-1.5 text-xs text-feil disabled:opacity-50"
        >
          {venter === "avvis" ? "…" : "Avvis"}
        </button>
      </div>
      {feil && (
        <p role="alert" className="mt-2 text-xs text-feil">
          {feil}
        </p>
      )}
    </div>
  );
}
