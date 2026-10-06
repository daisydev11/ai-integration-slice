// Local stand-in for the Gemini API, for development and tests only.
// The app talks to it through the official SDK exactly as it talks to
// Google: the SDK is pointed here with GEMINI_BASE_URL. It answers
//   POST /v1beta/models/<model>:generateContent
// and can be told to misbehave, so every failure path can be exercised
// without waiting for a real outage. Put one of these markers anywhere in an
// uploaded text file:
//   SIM:TIMEOUT        never answers (every attempt times out)
//   SIM:TIMEOUT_ONCE   the primary model hangs; the fallback model answers
//   SIM:ERROR_500      answers HTTP 500 every time
//   SIM:REJECT_400     answers HTTP 400 (the provider refuses the request)
//   SIM:PROSE          answers with a sentence instead of JSON
//   SIM:WRONG_SHAPE    answers with JSON that does not match the schema
//   SIM:WRONG_ONCE     wrong shape first; correct once the retry carries the correction
//   SIM:NOT_A_JOB      answers that the document is not a job description
//
// Run:  node dev/gemini-simulator.mjs
// Use:  set GEMINI_BASE_URL="http://localhost:4020" in .env
import { createServer } from "node:http";

const PORT = Number(process.env.SIMULATOR_PORT ?? 4020);
const DELAY_MS = Number(process.env.SIMULATOR_DELAY_MS ?? 1500);
let inFlight = 0;
let peak = 0;
const stamp = () => new Date().toISOString().slice(11, 23);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extract(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = (heading) => {
    const start = lines.findIndex((l) => l.toLowerCase().includes(heading));
    if (start === -1) return [];
    const out = [];
    for (const l of lines.slice(start + 1)) {
      if (!/^[-*•]/.test(l)) break;
      out.push(l.replace(/^[-*•]\s*/, ""));
    }
    return out;
  };
  const field = (name) => lines.find((l) => l.toLowerCase().startsWith(name + ":"))?.split(":").slice(1).join(":").trim() || null;
  const years = text.match(/(\d+)\+?\s*years/i);
  return {
    isJobDescription: true,
    title: lines.find((l) => !l.startsWith("<") && !l.includes(":"))?.replace(/^#+\s*/, "") ?? null,
    company: field("company"),
    location: field("location"),
    workMode: /remote/i.test(text) ? "remote" : /hybrid/i.test(text) ? "hybrid" : "unspecified",
    employmentType: /contract/i.test(text) ? "contract" : /full[- ]time/i.test(text) ? "full_time" : "unspecified",
    seniority: /senior/i.test(text) ? "senior" : /junior/i.test(text) ? "junior" : "unspecified",
    minYearsExperience: years ? Number(years[1]) : null,
    mustHave: bullets("requirement"),
    niceToHave: bullets("nice to have"),
    responsibilities: bullets("responsibilit"),
  };
}

function summarise(json) {
  const r = JSON.parse(json);
  return {
    headline: `${r.title ?? "This role"} is a ${r.seniority === "unspecified" ? "" : r.seniority + " "}position${r.company ? " at " + r.company : ""}.`.replace("  ", " "),
    summary: `You would need ${r.mustHave.slice(0, 3).join(", ") || "the skills listed"}. The work is ${r.workMode === "unspecified" ? "in a location that is not stated" : r.workMode}.`,
    questionsToAsk: [r.location ? null : "Where is the role based?", r.minYearsExperience === null ? "How much experience is expected?" : null, "What is the salary range?"].filter(Boolean).slice(0, 3),
  };
}

createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const match = req.url.match(/\/models\/([^/:]+):generateContent/);
  if (req.method !== "POST" || !match) return send(404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } });
  if (!req.headers["x-goog-api-key"]) return send(401, { error: { code: 401, message: "API key missing", status: "UNAUTHENTICATED" } });

  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const model = match[1];
  const parts = body.contents?.[0]?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("\n");
  const system = JSON.stringify(body.systemInstruction ?? "");
  const isSummary = system.includes("candidate");
  const isFallbackModel = model.includes("lite") !== isSummary; // the non-default model for this role

  inFlight++;
  peak = Math.max(peak, inFlight);
  console.log(`${stamp()} START ${model} ${isSummary ? "summarise" : "extract"}${text.includes("previous reply was rejected") ? " (retry with correction)" : ""}  in flight: ${inFlight}`);
  let counted = true;
  const leave = () => {
    if (!counted) return false;
    counted = false;
    inFlight--;
    return true;
  };
  const finish = (status, payload) => {
    if (leave()) console.log(`${stamp()} END   ${model} -> HTTP ${status}  in flight: ${inFlight}  (peak ${peak})`);
    send(status, payload);
  };
  // The response closing without an answer means the caller gave up (its timeout fired).
  res.on("close", () => {
    if (leave()) console.log(`${stamp()} ABORT ${model} (client gave up)  in flight: ${inFlight}`);
  });

  if (text.includes("SIM:TIMEOUT") && !(text.includes("SIM:TIMEOUT_ONCE") && isFallbackModel)) return; // never answer
  await sleep(DELAY_MS);
  if (res.destroyed) return;
  if (text.includes("SIM:ERROR_500")) return finish(500, { error: { code: 500, message: "Internal error", status: "INTERNAL" } });
  if (text.includes("SIM:REJECT_400")) return finish(400, { error: { code: 400, message: "Unsupported document", status: "INVALID_ARGUMENT" } });

  let reply;
  const wrongOnce = text.includes("SIM:WRONG_ONCE") && !text.includes("previous reply was rejected");
  if (text.includes("SIM:PROSE")) reply = "Sure! Here are the requirements I found in the document you shared: strong communication skills.";
  else if (text.includes("SIM:WRONG_SHAPE") || wrongOnce) reply = JSON.stringify({ jobTitle: "Product Designer", requirements: "Figma, research", seniority: "expert" });
  else if (isSummary) reply = JSON.stringify(summarise(text));
  else if (text.includes("SIM:NOT_A_JOB")) reply = JSON.stringify({ isJobDescription: false, title: null, company: null, location: null, workMode: "unspecified", employmentType: "unspecified", seniority: "unspecified", minYearsExperience: null, mustHave: [], niceToHave: [], responsibilities: [] });
  else reply = JSON.stringify(extract(text || "Document"), null, 1);

  finish(200, {
    candidates: [{ content: { role: "model", parts: [{ text: reply }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: Math.ceil((raw.length) / 4), candidatesTokenCount: Math.ceil(reply.length / 4), totalTokenCount: Math.ceil((raw.length + reply.length) / 4) },
    modelVersion: model,
  });
}).listen(PORT, () => console.log(`[simulator] Gemini simulator on http://localhost:${PORT}, ${DELAY_MS}ms per call`));
