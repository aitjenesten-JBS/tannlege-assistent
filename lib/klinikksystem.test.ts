import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { behandleBooking, bestillTime, finnBooking, finnLedigeTider, flyttTime, hentBookingerTilGjennomgang } from "@/lib/kalender";
import { hentIntegrasjonslogg, tilFhirAppointment } from "@/lib/klinikksystem";

const NAA = new Date("2026-09-29T08:00:00Z");
const kontakt = { navn: "Kari Nordmann", telefon: "45678901", epost: "kari@example.no" };

async function bestill(behandling = "undersokelse", fra_dato?: string) {
  const [t] = (await finnLedigeTider({ behandling, fra_dato }, NAA)).ledige_tider;
  return bestillTime({ behandling, tidspunkt: t.tidspunkt, behandler: t.behandler_id, ...kontakt, kommentar: "Første gang" }, NAA);
}

test("FHIR Appointment har riktig struktur, status og UTC-tid", () => {
  const booking = {
    kode: "TTK-TEST2", behandling_id: "undersokelse", behandler_id: "sara_haugen", tidspunkt: "2026-10-07T08:00",
    varighet_min: 45, navn: "Kari Nordmann", telefon: "45678901", epost: "kari@example.no", opprettet: "2026-09-29T08:00:00.000Z",
  };
  const a = tilFhirAppointment(booking, "opprettet");
  assert.equal(a.resourceType, "Appointment");
  assert.equal(a.status, "pending");
  assert.equal(a.start, "2026-10-07T06:00:00.000Z");
  assert.equal(a.end, "2026-10-07T06:45:00.000Z");
  assert.equal(a.contained[0].telecom[0].value, "+4745678901");
  assert.equal(tilFhirAppointment(booking, "bekreftet").status, "booked");
  assert.equal(tilFhirAppointment(booking, "avvist").status, "cancelled");
});

test("uten webhook-adresse logges hendelsen som ikke konfigurert", async () => {
  delete process.env.BOOKING_WEBHOOK_URL;
  const b = await bestill();
  const [siste] = await hentIntegrasjonslogg();
  assert.equal(siste.kode, b.bookingkode);
  assert.equal(siste.hendelse, "opprettet");
  assert.equal(siste.status, "ikke_konfigurert");
});

test("webhook mottar FHIR-pakke for opprettet, flyttet og bekreftet", async () => {
  const mottatt: { hendelse: string; status: string; type: string }[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      const p = JSON.parse(data);
      mottatt.push({ hendelse: p.hendelse, status: p.appointment.status, type: String(req.headers["content-type"]) });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((ok) => server.listen(0, ok));
  const port = (server.address() as { port: number }).port;
  process.env.BOOKING_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  try {
    const b = await bestill("etterkontroll", "2026-10-12");
    const [ny] = (await finnLedigeTider({ behandling: "etterkontroll", fra_dato: "2026-10-19" }, NAA)).ledige_tider;
    await flyttTime({ bookingkode: b.bookingkode, telefon: kontakt.telefon, nytt_tidspunkt: ny.tidspunkt, behandler: ny.behandler_id }, NAA);
    await behandleBooking(b.bookingkode, "bekreft", NAA);
    assert.deepEqual(mottatt.map((m) => `${m.hendelse}:${m.status}`), ["opprettet:pending", "flyttet:pending", "bekreftet:booked"]);
    assert.ok(mottatt.every((m) => m.type === "application/fhir+json"));
    const [siste] = await hentIntegrasjonslogg();
    assert.equal(siste.status, "sendt");
    assert.equal(siste.http, 200);
  } finally {
    delete process.env.BOOKING_WEBHOOK_URL;
    server.close();
  }
});

test("webhook som feiler stopper ikke bookingen", async () => {
  process.env.BOOKING_WEBHOOK_URL = "http://127.0.0.1:9/finnes-ikke";
  try {
    const b = await bestill("etterkontroll", "2026-10-13");
    assert.equal(b.status, "reservert");
    const [siste] = await hentIntegrasjonslogg();
    assert.equal(siste.status, "feilet");
  } finally {
    delete process.env.BOOKING_WEBHOOK_URL;
  }
});

test("avvist bestilling frigir tiden og kan ikke endres av pasienten", async () => {
  const b = await bestill("etterkontroll", "2026-10-14");
  await behandleBooking(b.bookingkode, "avvis", NAA);
  const oversikt = (await hentBookingerTilGjennomgang()).find((x) => x.kode === b.bookingkode);
  assert.equal(oversikt?.gjennomgang, "avvist");
  await assert.rejects(finnBooking({ bookingkode: b.bookingkode, telefon: kontakt.telefon }), /Fant ingen/);
  await assert.rejects(behandleBooking(b.bookingkode, "bekreft", NAA), /allerede avvist/);
  // Tiden er frigitt: samme tid kan bookes på nytt.
  const oversiktFor = (await hentBookingerTilGjennomgang()).find((x) => x.kode === b.bookingkode)!;
  const igjen = await bestillTime(
    { behandling: "etterkontroll", tidspunkt: b.tidspunkt, behandler: oversiktFor.behandler_id, ...kontakt },
    NAA,
  );
  assert.equal(igjen.status, "reservert");
});
