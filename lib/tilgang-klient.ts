// Nettleser-siden av tilgangskoden: ?tilgang=… i lenken lagres og sendes med til API-et.
const NOKKEL = "demo-tilgang";

/** Leser ?tilgang= fra adressen, husker den og fjerner den fra adresselinjen. */
export function lagreTilgangFraUrl() {
  try {
    const url = new URL(window.location.href);
    const kode = url.searchParams.get("tilgang");
    if (!kode) return;
    localStorage.setItem(NOKKEL, kode);
    url.searchParams.delete("tilgang");
    window.history.replaceState(null, "", url.toString());
  } catch {
    // privat modus o.l.: da gjelder koden bare denne sidevisningen
  }
}

export function tilgangHeader(): Record<string, string> {
  try {
    const kode = localStorage.getItem(NOKKEL);
    return kode ? { "x-demo-tilgang": kode } : {};
  } catch {
    return {};
  }
}
