// Tilgang til sekretærens sider (/admin og /api/admin/*). Med ADMIN_NOKKEL satt kreves den;
// uten er admin bare åpen lokalt (utvikling), aldri i produksjon.
export function harAdminTilgang(nokkel: string | null | undefined): boolean {
  const forventet = process.env.ADMIN_NOKKEL;
  if (forventet) return nokkel === forventet;
  return process.env.NODE_ENV !== "production";
}
