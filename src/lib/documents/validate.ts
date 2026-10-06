import { checkNameAndSize, extensionOf, uploadRules } from "@/lib/documents/rules";

type Checked = { ok: true; mimeType: string; extension: string } | { ok: false; reason: string };

/**
 * Full server-side check of one uploaded file. The type is decided by the
 * extension AND the content: a renamed image or a truncated PDF is caught
 * here, before it is stored and before a model call is paid for.
 */
export function checkFile(name: string, bytes: Uint8Array): Checked {
  const basic = checkNameAndSize(name, bytes.byteLength);
  if (basic) return { ok: false, reason: basic };

  const extension = extensionOf(name) as keyof typeof uploadRules.allowedTypes;
  if (extension === ".pdf") {
    const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
    const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 1024))).toString("latin1");
    if (head !== "%PDF-") return { ok: false, reason: "This is not a PDF file, although its name ends in .pdf." };
    if (!tail.includes("%%EOF")) return { ok: false, reason: "This PDF is incomplete or corrupted." };
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, reason: "This is not a readable text file." };
    }
    if (text.includes("\u0000")) return { ok: false, reason: "This is not a readable text file." };
    if (text.trim().length === 0) return { ok: false, reason: "This file contains no text." };
  }
  return { ok: true, mimeType: uploadRules.allowedTypes[extension], extension };
}
