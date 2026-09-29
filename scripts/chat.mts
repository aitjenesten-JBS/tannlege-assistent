// Chat med assistenten i terminalen: npm run chat
import { createInterface } from "node:readline/promises";
import { svar } from "@/lib/assistent";

const samtaleId = crypto.randomUUID();
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("Tannlege-assistent (terminal). Skriv «exit» for å avslutte.\n");

while (true) {
  const melding = (await rl.question("Du: ")).trim();
  if (!melding) continue;
  if (melding === "exit") break;
  const res = await svar(samtaleId, melding);
  for (const k of res.toolKall) {
    console.log(`  [${k.feil ? "FEIL " : ""}${k.navn}] ${JSON.stringify(k.input)}`);
  }
  console.log(`\nAssistent: ${res.tekst}\n`);
}
rl.close();
