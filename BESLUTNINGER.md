# Beslutninger

Logg over valg underveis, og steder der jeg overstyrte AI-en. Nyeste nederst.

## 2026-09-29 – Oppsett

### Prosjektmappe `chat-widget-tannlege`
Arbeidsmappen het opprinnelig `chat-widget tannlege`. Mellomrommet gjør den ugyldig som npm-pakkenavn, så `create-next-app .` feiler. Claude foreslo å legge prosjektet i en undermappe. Jeg valgte i stedet å gi rotmappen et navn uten mellomrom og holde prosjektet i roten.

### Modell: `claude-sonnet-5-5`
Planen sa `claude-sonnet-5`, men den gjeldende modell-ID-en er `claude-sonnet-5-5`. Én modell for alle henvendelser, uten ruting mellom modeller. Det holder koden og evalen enkel.

### Modellbruk under utviklingen
Opus 5.5 tar de tunge stegene: kalenderlogikk, tool-løkke, systemprompt, eval og feilretting. Sonnet 5.5-subagenter tar enkle, avgrensede oppgaver som datafiler og stubber, og det de lager blir gjennomgått før commit.

### Ingen RAG
Priser, åpningstider, ansatte og behandlinger er til sammen noen få hundre linjer, så alt legges rett i systemprompten fra `data/*.json`. Én kilde til sannhet, ingen vektordatabase, og ingen risiko for at et prisoppslag bommer.

### Stack
Next.js (App Router, TypeScript, Tailwind) på Vercel. Upstash Redis lagrer bookinger og brukes til rate limiting. `tsx` brukes til å teste tools i terminal og til å kjøre eval.

### Antakelser om klinikkdriften (bekreft med eierne)
- **Varigheter:** undersøkelse 45 min, fylling 30/45/60 min for 1/2/3 flater, rotfylling 90 min, ukomplisert trekking 45 min, akutt 30 min, etterkontroll 15 min.
- **Behandlere:** tannpleier (Emma Dahl) tar undersøkelse og rens. Tannlegene tar alt.
- **Ikke bookbart på nett:** kirurgisk fjerning, krone, fasade og OPG. Disse avtales etter undersøkelse.
- **Kalender:** lunsj 11:30–12:00, og 2 akutt-tider holdes av hver dag. Kalenderen fylles med tilfeldige opptatte tider (fast seed), så den ser realistisk ut og evalen blir deterministisk.
- **Rotfylling:** varigheten er 90 min uansett antall kanaler. Prisen oppgis per antall kanaler fra prislisten.

## 2026-09-29 – Kalender, tools og API-rute

### Samtalen lagres på serveren, og historikken endres aldri
Klienten sender bare `samtaleId` og den nye meldingen. Serveren holder hele historikken, også thinking-blokkene, i Redis (24 t). Grunnene:
- Sonnet 5.5 binder thinking-blokker til uendret historikk. Hvis klienten sendte en forkortet historikk, kunne API-et avvise kallet.
- Klienten kan ikke sende inn en forfalsket assistent-historikk («du har allerede lovet meg rabatt»).

### Dagens dato kommer som system-melding, ikke i systemprompten
Systemprompten er byte-lik fra kall til kall, så prompt-cachen treffer. Dato, klokkeslett og «åpent/stengt nå» legges inn som en `role: "system"`-melding etter hver brukermelding. Da kan brukeren ikke forfalske tiden, og assistenten vet om den skal henvise til klinikken (åpent) eller til legevakt (stengt).

### Telefonnummer kreves for å flytte og avbestille
Planen hadde bare bookingkode på `flytt_time` og `avbestill_time`. Jeg la til telefon, slik at en gjettet kode ikke er nok til å endre andres timer. Feil kode og feil telefon gir samme feilmelding.

### Tool-løkken ligger i `lib/assistent.ts`, ikke i ruten
API-ruten, terminalskriptet (`npm run chat`) og evalen bruker samme funksjon. Ruten gjør bare validering og rate limiting.

### Modelloppsett
- `effort: "low"`. Dette er chat, og low anbefales som startpunkt for Sonnet 5.5. Nivået justeres etter evalen.
- Server-side fallback (`fallbacks: "default"`). Avslag i kategoriene cyber og frontier_llm prøves på nytt med Sonnet 5. Andre avslag gir en fast tekst som henviser til klinikken, og avslaget lagres ikke i historikken.
- Alle tools har `strict: true`, og behandling og behandler er enum-er. Modellen kan dermed ikke finne på behandlings- eller behandler-id-er.
- `tool_choice` er `auto` (Sonnet 5.5 avviser tvunget tool-bruk). Styringen ligger i systemprompten.

### Kalenderregler (antakelser)
- Tider i steg på 15 minutter, tidligst én time frem i tid, og søket går 30 dager frem.
- Maks 5 forslag og maks 2 per dag, så forslagene spres utover dagene.
- Akutt-tidene er 08:30 og 13:00 hver dag, fordelt på tannlegene etter tur. Bare «akutt» kan bestille dem.
- Helligdager håndteres ikke (kjent begrensning).
- Tidene lagres som Oslo-veggklokke (`2026-09-30T09:15`), så serverens tidssone (UTC på Vercel) ikke kan gi feil.
- Belegget er seedet per behandler og dato, så kalenderen er lik mellom kjøringer. Det gjør evalen stabil.
- Ingen låsing mot at to bruker samme tid samtidig. Tiden sjekkes på nytt rett før lagring. Det holder for en demo.

### Lagring og rate limit
- Uten Upstash-nøkler brukes et minnelager, så prosjektet kjører lokalt og testene går uten eksterne tjenester.
- Rate limit er 20 meldinger per IP per time og 500 per døgn totalt, som et kostnadstak. Meldinger kan være maks 1000 tegn, og en samtale maks 30 brukermeldinger.

## 2026-09-29 – Rollespill-test uten API-nøkkel
Før API-nøkkelen var på plass spilte Claude Code modellens rolle. Den fulgte systemprompten, bestemte tool-kallene og skrev svarene, mens verktøyene kjørte mot den ekte kalenderkoden. Sju scenarier ble kjørt: ny pasient booker, flytting (først med feil telefon), tannpine med spørsmål om medisin, rødt flagg om kvelden, overføring av en faktura-henvendelse, avbestilling og et forsøk på å få rabatt. Testen sjekker verktøyene og prompten, ikke hvordan Sonnet 5.5 faktisk oppfører seg. Det gjøres i evalen.

Funn og rettelser:
- **Gebyrteksten var feil (overstyrt).** `klinikk.json` sa «Ikke møtt eller for sent avbestilt: 750 kr …». Prislisten dekker bare «ikke møtt», og klinikken har ingen oppgitt avbestillingsfrist. Teksten ville fått boten til å kreve gebyr for sen avbestilling uten grunnlag. Den er endret til «Ikke møtt til timen». Feilen kom fra spesifikasjonen AI-en skrev til datafil-agenten, og ble fanget ved å lese den ferdige systemprompten.
- **`npm run chat` startet ikke.** Prosjektet er CommonJS, så top-level await i skriptet feilet. Skriptet er gjort om til `.mts`.
- **For få valg hos en bestemt behandler.** Søket ga én tid per dag. Pasienten spurte etter «torsdag hos Sara» og fikk ett eneste valg. Nå gis to tider per dag med minst én time mellom når pasienten har valgt behandler.
- **Bekreftet at det virker:** en tid som ikke er tilbudt blir avvist, den gamle tiden blir ledig etter flytting, feil telefon og feil kode gir samme nøytrale svar, og akutt-tiden 08:30 dukker opp for akutt-søk.
