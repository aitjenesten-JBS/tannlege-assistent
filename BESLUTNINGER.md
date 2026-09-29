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
- **Behandlere:** tannpleieren tar undersøkelse og rens. Tannlegene tar alt.
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

## 2026-09-29 – Widget, tidsvelger og kontrollspørsmål

### Kalender i chatten i stedet for tider som tekst (brukerens ønske)
Første utkast lot modellen liste opp 5 tider i teksten. Jeg overstyrte det og ville ha en kalender som på vanlige bookingsider, der man klikker seg gjennom dag, tid, bekreftelse og skjema. Modellen velger behandling og åpner kalenderen med verktøyet `vis_tidsvelger`. Kalenderen henter ledige tider rett fra timeboken (`/api/ledige`), uten å gå via modellen, så det er raskt og gratis. Skjemaet booker direkte (`/api/bestill`), og modellen får den bekreftede bookingen som system-melding og skriver bekreftelsen.

### Ingen ekstra ja/nei-runde før kalenderen
Modellen sier hva den setter opp («undersøkelse, 45 min, 1450 kr») og åpner kalenderen i samme svar. Kalenderen viser behandlingen øverst, så pasienten kan rette. Det sparer én runde med venting og ett API-kall.

### Bestillinger går til sekretærens gjennomgang (brukerens presisering)
Hovedformålet er å få bestillinger inn i et system som tannhelsesekretæren går gjennom, ikke å erstatte henne. Derfor:
- Feltet «Hva gjelder timen?» (valgfritt, maks 200 tegn) er der pasienten beskriver det som ikke passer som en vanlig time, for eksempel tannbleking eller ønsket trekking.
- Behandlinger som ikke kan bestilles på nett, bookes som undersøkelse med ønsket i feltet.
- `/admin` viser «Bestillinger til gjennomgang», der kommentaren er uthevet, og i tillegg henvendelsene.

### Undersøkelse først, med unntak (antakelse, bekreft med klinikken)
Nye pasienter og «vanlig time» får undersøkelse. Fylling, rotfylling og trekking bookes direkte bare hvis tannlegen har anbefalt det etter en undersøkelse. Ellers blir det undersøkelse med ønsket i kommentarfeltet. Plager nå gir akutt-time, og røde flagg går foran alt.

### Helseopplysninger
- **Chat:** fast setning «Dette kan ikke AI-assistenten vurdere. Ta kontakt med klinikken …» (brukerens ønske). Røde flagg kommer før setningen. Ingen førstehjelpsråd, heller ikke velmente som «legg tannen i melk», fordi en demo-bot ikke skal gi medisinske råd.
- **Kommentarfeltet:** ordlistesjekk både i nettleseren og på serveren. Symptomer, sykdommer og medisiner avvises med samme melding. Behandlingsønsker («trekke visdomstann», «tannlegeskrekk») er bevisst tillatt, fordi sekretæren trenger dem.

### Bekreftelsesmail og kalenderfil
Resend sender bare til `EPOST_DEMO_MOTTAKER` (eieren). Uten eget domene kan Resend ikke levere til andre, og et åpent skjema som sender e-post til vilkårlige adresser kan misbrukes. Alle andre besøkende ser en forhåndsvisning av den samme e-posten i chatten. Alle får «Legg til i kalender» (.ics), der tiden er regnet om fra Oslo-tid til UTC, med sommer- og vintertid testet.

### Kontrollspørsmålene: data fra nettsiden
Ved rollespill av de 30 kontrollspørsmålene besto 23 av 30. Alle de røde skyldtes at dataene manglet: tannbleking, fyllingstyper, rotfylling, implantater og kontaktskjema. Jeg hentet teksten fra klinikkens nettside til `data/tjenester.json`, med kildelenke per oppføring, og skjerpet helsereglene. Etterpå besto 30 av 30. Evalen ble selv testet mot bevisst dårlige svar (diagnose, «legg tannen i melk», oppdiktet blekepris, busslinje). Det avslørte at diagnosemønsteret ikke fanget «det er nok hull» og «kan være en infeksjon». Mønsteret ble skjerpet. Rollespillet er Claude Codes svar etter prompten, ikke Sonnet 5.5. `npm run eval` kjører den ekte modellen når API-nøkkelen er på plass.

## 2026-09-29 – Kostnadsvern (10 USD på kontoen)
Kontoen har bare 10 USD, og demoen må fortsatt virke når Nuto ser på den. Derfor:
- **Faktisk forbruk registreres per kall** (`lib/kostnad.ts`) ut fra `usage` i svaret, med prisene for Sonnet 5.5 (input 2, cache-skriving 2,50, cache-lesing 0,20, output 10 USD per million tokens).
- **Harde tak:** `DAGSBUDSJETT_USD` (1,00) og `TOTALBUDSJETT_USD` (6,00). Når et tak er nådd, svarer chatten at demoen har nådd kostnadstaket og henviser til telefon. Kalenderen og skjemaet virker fortsatt, fordi de ikke bruker modellen.
- **Meldingstak:** i tillegg maks 150 meldinger per døgn totalt og 20 per IP per time (Upstash).
- **Evalen** viser kostnad per kjøring og stopper ved `--maks-usd` (standard 1,50).
- **Testing i trinn:** telle tokens (gratis), røyktest med 3 spørsmål, full eval, deretter bare de røde på nytt. Alt som kan testes uten modellen (kalender, verktøy, UI, regler) er testet uten API-kall først.

## 2026-09-29 – Testpakke med 85 spørsmål mot Sonnet 5.5
Oppdragsgiver leverte 80 testspørsmål med akseptkriterier og ba om fire nivåer (PASS, PARTIAL, WARNING, FAIL). Fem spørsmål fra forrige stresstest ble lagt til.

**Justerte kriterier.** Tre kriterier antok at boten ikke har tilgang til timeboken (#6, #7, #78). Den har tilgang, så kriteriet ble at den *bruker* verktøyet og ikke finner på tider. #56 og #58 ba om nyttig akuttinformasjon. Det løste jeg med førstehjelpsråd hentet ordrett fra Helsenorge og NHI (`data/forstehjelp.json`), i stedet for at modellen skriver sine egne.

**Vurdering.** En dommer (Sonnet 5.5, effort low, strukturert output) vurderer hvert svar mot kriteriet med botens egen prompt som fasit. Kritiske regex-mønstre (oppdiktet pris, diagnose, stopp av medisin, antibiotikanavn, lekket prompt) gir automatisk FAIL. Mangler et påkrevd mønster eller verktøykall, blir resultatet maks PARTIAL.

**Første kjøring: 78 grønne, 3 gule, 1 oransje og 3 røde.** Funn:
- **#51 (kraftig tannverk), ekte feil:** svaret manglet helsesetningen og henvisningen. Modellen skrev dem før den åpnet kalenderen, men koden returnerte bare teksten fra siste runde i verktøyløkken. Nå tas tekst fra alle runder med. Denne feilen ville rammet alle svar der kalenderen ble åpnet.
- **#17:** prompten motsa seg selv. «Si aldri at noe er normalt» kolliderte med klinikkens egen tekst om rotfylling. Regelen gjelder nå pasientens egne plager.
- **#6, #28 og #78:** mindre presiseringer. Boten sier at klinikken går gjennom bestillingen, antar ikke tillegg i prisen, og sjekker ledige tider uten å spørre om behandlingstype først.
- **#42, #43 og #81:** falske alarmer i mine egne mønstre («kan ikke si *om du har hull*»). Mønstrene er rettet. Dommeren ga PASS på alle tre.

**Kostnad.** Den første kjøringen stoppet på kostnadsgrensen etter 31 tester, 1,63 USD. Årsaken var at prompt-cachen ikke traff: automatisk caching setter bruddpunktet på siste melding, som er ulik i hver samtale. Med et eksplisitt bruddpunkt på systemprompten falt kostnaden fra omtrent 0,05 til 0,003 USD per bot-kall. En full kjøring med dommer koster nå rundt 0,75 USD.

**Sluttresultat: 85 av 85 PASS** (`eval/resultat.md`, alle svar i `eval/resultat-svar.json`). #81 ble kjørt på nytt etter rettingen av mønsteret. Samlet API-forbruk under utviklingen er omtrent 3,40 USD av 10.

## 2026-09-29 – Bestillingene inn i klinikkens system
Målet var å vise at bestillinger faktisk når klinikken, ikke bare ligger i en demo-database.

- **Reservert, deretter bekreftet.** En bestilling fra chatten reserverer tiden og får status *Ny*. Sekretæren bekrefter eller avviser i `/admin`. Pasienten får først «Bestilling mottatt» på e-post, og deretter «Timen er bekreftet» eller «Om bestillingen din». Ved avvisning frigis tiden, og pasienten kan ikke lenger endre bookingen selv, fordi klinikken tar kontakt. Flytter pasienten timen, går den tilbake til *Ny*.
- **FHIR R4 Appointment som format.** Hver hendelse (opprettet, flyttet, avbestilt, bekreftet, avvist) sendes som en FHIR Appointment til `BOOKING_WEBHOOK_URL`. Statusene er `pending`, `booked` og `cancelled`, og pasienten ligger som en «contained» Patient. FHIR er standarden norske journal- og EPJ-systemer bruker eller beveger seg mot, så formatet viser at dette er tenkt som en integrasjon og ikke en hjemmesnekret eksport.
- **Webhook i stedet for direkte integrasjon.** Norske klinikksystemer som Opus Dental har ikke åpne API-er for timebøker. En ekte kobling krever avtale med leverandøren. Webhooken viser *hvor* den koblingen sitter. I demo kan den peke til webhook.site, og uten mottaker logges pakken likevel.
- **Integrasjonen skal aldri stoppe en booking.** Timeout er 4 sekunder, feil logges, og pasienten merker ingenting. Alle sendinger (status, HTTP-kode, mottaker og hele pakken) logges og vises i admin under «Sendt til klinikksystemet».
- **Personvern.** Pakken inneholder navn, telefon og e-post. Det er dokumentert i `.env.example` at bare testdata skal sendes til tredjeparts mottakere.
- **Testet:** FHIR-struktur og UTC-tid, webhook mot en lokal HTTP-server (opprettet, flyttet og bekreftet i riktig rekkefølge og med riktig content-type), at en webhook som feiler ikke stopper bookingen, og at avvisning frigir tiden. 19 enhetstester totalt.

## 2026-09-29 – Tilgangskode for AI-chatten
Den offentlige demoen bruker mine API-kreditter. Å kreve innlogging med e-post ville gitt for mye friksjon for den som leser søknaden. Derfor en tilgangskode i lenken (`?tilgang=…`, `DEMO_TILGANG` i Vercel). Med koden får man den ekte modellen. Uten koden får man den skriptede demoen, som er gratis, mens kalender, booking og innboks virker likt. Koden lagres i nettleseren og fjernes fra adresselinjen, og den sammenlignes i konstant tid. Kostnadstakene gjelder fortsatt i tillegg.
