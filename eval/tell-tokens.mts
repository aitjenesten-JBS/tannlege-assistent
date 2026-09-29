// Gratis: teller tokens i systemprompt + tools med count_tokens, og anslår kostnad per spørsmål.
//   npm run tokens
import Anthropic from "@anthropic-ai/sdk";
import { MODELL } from "@/lib/assistent";
import { SYSTEMPROMPT } from "@/lib/systemprompt";
import { tools } from "@/lib/tools";

const klient = new Anthropic();
const { input_tokens } = await klient.beta.messages.countTokens({
  model: MODELL,
  system: [{ type: "text", text: SYSTEMPROMPT }],
  tools,
  messages: [{ role: "user", content: "Hva koster en undersøkelse?" }],
});
const pris = (tok: number, perM: number) => (tok * perM) / 1_000_000;
const forsteKall = pris(input_tokens, 2.5) + pris(300, 10); // cache skrives første gang
const cachetKall = pris(input_tokens, 0.2) + pris(300, 10); // resten leser fra cache (5 min)
console.log(`Systemprompt + tools + ett spørsmål: ${input_tokens} tokens (${MODELL})`);
console.log(`Anslått kostnad: første kall ${forsteKall.toFixed(4)} USD, senere kall innen 5 min ${cachetKall.toFixed(4)} USD`);
console.log(`50 spørsmål (1–2 kall hver) ≈ ${(forsteKall * 3 + cachetKall * 75).toFixed(2)} USD`);
