import { Resend } from "resend";
import { epostEmne, epostHtml, epostTekst, type EpostTime, type EpostType } from "@/lib/epostmal";
import { lagIcs, type IcsTime } from "@/lib/ics";

// Sender bekreftelsesmail via Resend. I demoen sendes det bare til adressen i EPOST_DEMO_MOTTAKER:
// uten eget domene kan Resend bare levere til kontoeierens adresse, og et åpent skjema som
// sender e-post til hvem som helst kan misbrukes. Alle andre får forhåndsvisning i chatten.

export type EpostStatus = "sendt" | "forhandsvisning" | "feilet";

export async function sendBekreftelse(time: EpostTime & IcsTime, til: string, type: EpostType = "mottatt"): Promise<EpostStatus> {
  const nokkel = process.env.RESEND_API_KEY;
  const tillatt = process.env.EPOST_DEMO_MOTTAKER?.trim().toLowerCase();
  if (!nokkel || !tillatt || til.trim().toLowerCase() !== tillatt) return "forhandsvisning";

  try {
    const { error } = await new Resend(nokkel).emails.send({
      from: process.env.EPOST_AVSENDER || "Torget demo <onboarding@resend.dev>",
      to: til.trim(),
      subject: epostEmne(time, type),
      html: epostHtml(time, type),
      text: epostTekst(time, type),
      // Kalenderfil bare når timen står (ikke ved avvist).
      attachments: type === "avvist" ? [] : [{ filename: "tannlegetime.ics", content: Buffer.from(lagIcs(time)), contentType: "text/calendar" }],
    });
    if (error) {
      console.error("Resend:", error.message);
      return "feilet";
    }
    return "sendt";
  } catch (e) {
    console.error("Resend:", e instanceof Error ? e.message : e);
    return "feilet";
  }
}
