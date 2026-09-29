import { test } from "node:test";
import assert from "node:assert/strict";
import { harAiTilgang, TILGANG_HEADER } from "@/lib/tilgang";

const req = (kode?: string) => new Request("http://x/api/chat", { headers: kode ? { [TILGANG_HEADER]: kode } : {} });

test("uten DEMO_TILGANG er AI-chatten åpen (lokal utvikling)", () => {
  delete process.env.DEMO_TILGANG;
  assert.equal(harAiTilgang(req()), true);
});

test("med DEMO_TILGANG kreves riktig kode", () => {
  process.env.DEMO_TILGANG = "hemmelig-kode-123";
  try {
    assert.equal(harAiTilgang(req()), false);
    assert.equal(harAiTilgang(req("feil")), false);
    assert.equal(harAiTilgang(req("hemmelig-kode-12")), false);
    assert.equal(harAiTilgang(req("hemmelig-kode-123")), true);
  } finally {
    delete process.env.DEMO_TILGANG;
  }
});
