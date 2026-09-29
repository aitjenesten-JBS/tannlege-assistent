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
