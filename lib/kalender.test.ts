import { test } from "node:test";
import assert from "node:assert/strict";
import {
  akuttTider,
  avbestillTime,
  bestillTime,
  Brukerfeil,
  finnBooking,
  finnLedigeTider,
  flyttTime,
  formaterTidspunkt,
  hentHenvendelser,
  ledigeTiderPerDag,
  naaOslo,
  normaliserTelefon,
  overforTilKlinikken,
  simulertBelegg,
  tolkTidspunkt,
} from "@/lib/kalender";

// Tirsdag 29. september 2026 kl. 10:00 i Oslo (CEST = UTC+2).
const NAA = new Date("2026-09-29T08:00:00Z");
const kontakt = { navn: "Test Testesen", telefon: "+47 912 34 567", epost: "test@example.com" };

test("naaOslo gir Oslo-tid", () => {
  assert.deepEqual(naaOslo(NAA), { dato: "2026-09-29", minutter: 600 });
  // Vintertid (CET = UTC+1)
  assert.deepEqual(naaOslo(new Date("2026-01-15T07:30:00Z")), { dato: "2026-01-15", minutter: 510 });
});

test("formaterer tidspunkt på norsk", () => {
  assert.equal(formaterTidspunkt("2026-09-30T09:15"), "onsdag 30. september kl. 09:15");
  assert.throws(() => tolkTidspunkt("2026-02-30T09:00"), Brukerfeil);
});

test("simulert belegg er deterministisk og respekterer lunsj og akutt-tider", () => {
  const a = simulertBelegg("magnus_lien", "2026-10-01");
  assert.deepEqual(a, simulertBelegg("magnus_lien", "2026-10-01"));
  assert.ok(a.length > 0);
  for (const blokk of a) {
    assert.ok(blokk.fra >= 480 && blokk.til <= 960);
    assert.ok(blokk.til <= 690 || blokk.fra >= 720, "overlapper lunsj");
  }
  assert.equal(akuttTider("2026-10-01").length, 2);
});

test("ledige tider har riktig varighet, riktig behandler og ligger frem i tid", async () => {
  const res = await finnLedigeTider({ behandling: "rotfylling" }, NAA);
  assert.equal(res.varighet_min, 90);
  assert.ok(res.ledige_tider.length > 0 && res.ledige_tider.length <= 5);
  for (const t of res.ledige_tider) {
    assert.notEqual(t.behandler_id, "emma_dahl", "tannpleier skal ikke ta rotfylling");
    const { dato, min } = tolkTidspunkt(t.tidspunkt);
    assert.ok(dato > "2026-09-29" || min >= 660, "for tidlig i dag");
    assert.ok(min + 90 <= 960);
    assert.ok(min + 90 <= 690 || min >= 720, "overlapper lunsj");
  }
});

test("undersøkelse kan tas av tannpleier, helg hoppes over", async () => {
  const res = await finnLedigeTider({ behandling: "undersokelse", fra_dato: "2026-10-03", behandler: "emma_dahl" }, NAA);
  assert.ok(res.ledige_tider.every((t) => t.behandler_id === "emma_dahl"));
  assert.ok(res.ledige_tider.every((t) => !t.tidspunkt.startsWith("2026-10-03") && !t.tidspunkt.startsWith("2026-10-04")));
});

test("avviser feil behandlertype og behandlinger som ikke kan bestilles", async () => {
  await assert.rejects(finnLedigeTider({ behandling: "rotfylling", behandler: "emma_dahl" }, NAA), Brukerfeil);
  await assert.rejects(finnLedigeTider({ behandling: "krone_jeksel" }, NAA), /kan ikke bestilles på nett/);
});

test("vanlige behandlinger får ikke akutt-tidene, akutt gjør det", async () => {
  const dato = "2026-10-01";
  const [morgen] = akuttTider(dato);
  const tidspunkt = `${dato}T08:30`;
  await assert.rejects(
    bestillTime({ behandling: "etterkontroll", tidspunkt, behandler: morgen.behandler_id, ...kontakt }, NAA),
    /ikke ledig/,
  );
  const ok = await bestillTime({ behandling: "akutt", tidspunkt, behandler: morgen.behandler_id, ...kontakt }, NAA);
  assert.equal(ok.status, "bekreftet");
  await avbestillTime({ bookingkode: ok.bookingkode, telefon: kontakt.telefon });
});

test("booking, oppslag, flytting og avbestilling", async () => {
  const [forslag] = (await finnLedigeTider({ behandling: "fylling_2_flater" }, NAA)).ledige_tider;
  const bekreftet = await bestillTime(
    { behandling: "fylling_2_flater", tidspunkt: forslag.tidspunkt, behandler: forslag.behandler_id, ...kontakt },
    NAA,
  );
  assert.match(bekreftet.bookingkode, /^TTK-[A-Z2-9]{5}$/);
  assert.match(bekreftet.gebyr_ikke_mott, /750 kr/);

  // Samme tid kan ikke bookes to ganger
  await assert.rejects(
    bestillTime({ behandling: "fylling_2_flater", tidspunkt: forslag.tidspunkt, behandler: forslag.behandler_id, ...kontakt }, NAA),
    /ikke ledig/,
  );
  // og forsvinner fra ledige tider
  const etter = await finnLedigeTider({ behandling: "fylling_2_flater", behandler: forslag.behandler_id }, NAA);
  assert.ok(!etter.ledige_tider.some((t) => t.tidspunkt === forslag.tidspunkt));

  // Oppslag krever riktig telefon, og koden er ikke følsom for store/små bokstaver
  const funnet = await finnBooking({ bookingkode: bekreftet.bookingkode.toLowerCase(), telefon: "91234567" });
  assert.equal(funnet.tidspunkt, forslag.tidspunkt);
  await assert.rejects(finnBooking({ bookingkode: bekreftet.bookingkode, telefon: "98765432" }), /Fant ingen/);

  // Flytt til en ny ledig tid hos samme behandler
  const ny = (await finnLedigeTider({ behandling: "fylling_2_flater", behandler: forslag.behandler_id, fra_dato: "2026-10-06" }, NAA)).ledige_tider[0];
  const flyttet = await flyttTime({ bookingkode: bekreftet.bookingkode, telefon: kontakt.telefon, nytt_tidspunkt: ny.tidspunkt }, NAA);
  assert.equal(flyttet.tidspunkt, ny.tidspunkt);
  assert.equal(flyttet.behandler, forslag.behandler_navn);

  // Den gamle tiden er ledig igjen
  const igjen = await finnLedigeTider({ behandling: "fylling_2_flater", behandler: forslag.behandler_id }, NAA);
  assert.ok(igjen.ledige_tider.some((t) => t.tidspunkt === forslag.tidspunkt));

  const avbestilt = await avbestillTime({ bookingkode: bekreftet.bookingkode, telefon: kontakt.telefon });
  assert.equal(avbestilt.status, "avbestilt");
  await assert.rejects(finnBooking({ bookingkode: bekreftet.bookingkode, telefon: kontakt.telefon }), /Fant ingen/);
});

test("avviser tider i fortiden, i helg og i lunsjen", async () => {
  const base = { behandling: "etterkontroll", behandler: "magnus_lien", ...kontakt };
  await assert.rejects(bestillTime({ ...base, tidspunkt: "2026-09-29T09:00" }, NAA), /passert/);
  await assert.rejects(bestillTime({ ...base, tidspunkt: "2026-10-03T10:00" }, NAA), /ikke ledig/);
  await assert.rejects(bestillTime({ ...base, tidspunkt: "2026-10-01T11:30" }, NAA), /ikke ledig/);
});

test("validerer kontaktinfo", async () => {
  assert.equal(normaliserTelefon("0047 41 23 45 67"), "41234567");
  assert.throws(() => normaliserTelefon("12345"), Brukerfeil);
  const [t] = (await finnLedigeTider({ behandling: "etterkontroll" }, NAA)).ledige_tider;
  await assert.rejects(
    bestillTime({ behandling: "etterkontroll", tidspunkt: t.tidspunkt, behandler: t.behandler_id, ...kontakt, epost: "ikke-epost" }, NAA),
    /E-post/,
  );
});

test("overføring til klinikken lagres", async () => {
  await overforTilKlinikken({ oppsummering: "Spør om faktura", kontaktinfo: "91234567" }, NAA);
  const liste = await hentHenvendelser();
  assert.equal(liste.at(-1)?.oppsummering, "Spør om faktura");
});

test("kalendervisning: halvtimes-rutenett, ingen helg, og tidene kan faktisk bookes", async () => {
  const res = await ledigeTiderPerDag({ behandling: "fylling_1_flate", fra_dato: "2026-09-01", til_dato: "2026-10-31" }, NAA);
  const datoer = Object.keys(res.dager);
  assert.ok(datoer.length > 10);
  assert.ok(datoer.every((d) => d >= "2026-09-29"), "fortid skal ikke vises");
  assert.ok(!datoer.includes("2026-10-03") && !datoer.includes("2026-10-04"), "helg skal ikke vises");
  assert.ok(datoer.at(-1)! <= "2026-11-09", "maks 42 dager");
  const tider = Object.values(res.dager).flat();
  assert.ok(tider.every((t) => /:(00|30)$/.test(t.tid)));
  assert.ok(tider.every((t) => t.behandler_id !== "emma_dahl"));
  // Stikkprøve: en vist tid kan bookes, og forsvinner deretter fra visningen
  const valgt = res.dager["2026-10-07"][0];
  const b = await bestillTime({ behandling: "fylling_1_flate", tidspunkt: valgt.tidspunkt, behandler: valgt.behandler_id, ...kontakt }, NAA);
  const etter = await ledigeTiderPerDag({ behandling: "fylling_1_flate", fra_dato: "2026-10-07", til_dato: "2026-10-07", behandler: valgt.behandler_id }, NAA);
  assert.ok(!(etter.dager["2026-10-07"] ?? []).some((t) => t.tidspunkt === valgt.tidspunkt));
  await avbestillTime({ bookingkode: b.bookingkode, telefon: kontakt.telefon });
});

test("kommentar med helseopplysninger avvises, praktisk kommentar godtas", async () => {
  const { inneholderHelseopplysninger } = await import("@/lib/helse");
  assert.ok(inneholderHelseopplysninger("Har vondt i en jeksel"));
  assert.ok(inneholderHelseopplysninger("Bruker blodfortynnende"));
  assert.ok(inneholderHelseopplysninger("Jeg er gravid"));
  assert.ok(!inneholderHelseopplysninger("Første gang hos dere, kommer med barnevogn"));
  assert.ok(!inneholderHelseopplysninger("Trenger parkering nær inngangen"));
  assert.ok(!inneholderHelseopplysninger("Ønsker å trekke en visdomstann, har tannlegeskrekk"));
  assert.ok(!inneholderHelseopplysninger("Vil ha tannbleking"));
  const [t] = (await finnLedigeTider({ behandling: "undersokelse" }, NAA)).ledige_tider;
  const base = { behandling: "undersokelse", tidspunkt: t.tidspunkt, behandler: t.behandler_id, ...kontakt };
  await assert.rejects(bestillTime({ ...base, kommentar: "har verk og feber" }, NAA), /AI-assistenten/);
  const ok = await bestillTime({ ...base, kommentar: "Første gang hos dere" }, NAA);
  assert.equal(ok.kommentar, "Første gang hos dere");
  await avbestillTime({ bookingkode: ok.bookingkode, telefon: kontakt.telefon });
});

test("kalenderfil bruker riktig UTC-tid både sommer og vinter", async () => {
  const { lagIcs, osloTilUtc } = await import("@/lib/ics");
  assert.equal(osloTilUtc("2026-10-07T08:00").toISOString(), "2026-10-07T06:00:00.000Z"); // CEST
  assert.equal(osloTilUtc("2026-11-10T08:00").toISOString(), "2026-11-10T07:00:00.000Z"); // CET
  const ics = lagIcs({ bookingkode: "TTK-TEST1", behandling: "Undersøkelse", behandler: "Sara Haugen", tidspunkt: "2026-10-07T08:00", varighet_min: 45, adresse: "Torggata 7, 1234 Fjordvik" });
  assert.match(ics, /DTSTART:20261007T060000Z/);
  assert.match(ics, /DTEND:20261007T064500Z/);
  assert.ok(ics.includes("LOCATION:Torggata 7\\, 1234 Fjordvik"), "komma skal escapes i ICS");
});
