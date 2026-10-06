import { describe, expect, it } from "vitest";
import { aiConfig } from "@/lib/ai/config";
import { roles } from "@/lib/ai/prompts";
import { extractionSchema, parseModelOutput, summarySchema, toProviderSchema } from "@/lib/ai/schemas";
import { checkFile } from "@/lib/documents/validate";
import { explainFailure } from "@/lib/jobs/errors";

const good = {
  isJobDescription: true,
  title: "Product Designer",
  company: null,
  location: null,
  workMode: "remote",
  employmentType: "unspecified",
  seniority: "mid",
  minYearsExperience: 3,
  mustHave: ["Figma"],
  niceToHave: [],
  responsibilities: [],
};

describe("validating model output in our own code", () => {
  it("accepts a reply that matches the schema", () => {
    expect(parseModelOutput(extractionSchema, JSON.stringify(good))).toMatchObject({ ok: true });
  });

  it("rejects prose", () => {
    expect(parseModelOutput(extractionSchema, "Sure! Here are the requirements.")).toEqual({ ok: false, problem: "The reply was not valid JSON." });
  });

  it("rejects valid JSON of the wrong shape, naming the fields", () => {
    const result = parseModelOutput(extractionSchema, JSON.stringify({ jobTitle: "Designer", seniority: "expert" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain("isJobDescription");
  });

  it("rejects an enum value the schema does not list, an extra field, and an oversized string", () => {
    expect(parseModelOutput(extractionSchema, JSON.stringify({ ...good, seniority: "expert" })).ok).toBe(false);
    expect(parseModelOutput(extractionSchema, JSON.stringify({ ...good, salary: "a lot" })).ok).toBe(false);
    expect(parseModelOutput(extractionSchema, JSON.stringify({ ...good, title: "a".repeat(201) })).ok).toBe(false);
  });

  it("rejects an empty reply and a truncated one", () => {
    expect(parseModelOutput(summarySchema, "").ok).toBe(false);
    expect(parseModelOutput(summarySchema, '{"headline": "Senior des').ok).toBe(false);
  });

  it("sends the provider a JSON Schema generated from the same object", () => {
    const schema = toProviderSchema(extractionSchema) as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("isJobDescription");
    expect(Object.keys(schema.properties)).toEqual(Object.keys(good));
  });
});

describe("upload checks", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const max = aiConfig.upload.maxFileBytes;

  it("accepts text and a well-formed PDF", () => {
    expect(checkFile("role.txt", bytes("Designer wanted"))).toMatchObject({ ok: true, mimeType: "text/plain" });
    expect(checkFile("ROLE.PDF", bytes("%PDF-1.7\n...\n%%EOF\n"))).toMatchObject({ ok: true, mimeType: "application/pdf" });
  });

  it("rejects an empty file, a whitespace-only file and a disallowed type", () => {
    expect(checkFile("a.txt", bytes(""))).toMatchObject({ ok: false, reason: "This file is empty." });
    expect(checkFile("a.txt", bytes(" \n\t "))).toMatchObject({ ok: false });
    expect(checkFile("a.docx", bytes("hello"))).toMatchObject({ ok: false });
    expect(checkFile("no-extension", bytes("hello"))).toMatchObject({ ok: false });
  });

  it("accepts a file exactly at the size limit and rejects one byte more", () => {
    expect(checkFile("a.txt", new Uint8Array(max).fill(97)).ok).toBe(true);
    expect(checkFile("a.txt", new Uint8Array(max + 1).fill(97)).ok).toBe(false);
  });

  it("looks at the content, not just the name", () => {
    expect(checkFile("image.txt", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toMatchObject({ ok: false });
    expect(checkFile("notes.pdf", bytes("just some text"))).toMatchObject({ ok: false });
    expect(checkFile("cut-off.pdf", bytes("%PDF-1.7\nhalf a file"))).toMatchObject({ ok: false, reason: "This PDF is incomplete or corrupted." });
  });
});

describe("configuration", () => {
  it("every role has a prompt, and a written reason for every parameter it sets", () => {
    for (const [name, settings] of Object.entries(aiConfig.roles)) {
      const role = roles[name as keyof typeof roles];
      expect(role.systemPrompt.length).toBeGreaterThan(100);
      expect(Object.keys(role.why).sort()).toEqual(Object.keys(settings).sort());
    }
  });

  it("has a price for every model it can call, so cost can be estimated", () => {
    for (const settings of Object.values(aiConfig.roles)) {
      expect(aiConfig.pricingPerMillionTokens[settings.model]).toBeDefined();
      expect(aiConfig.pricingPerMillionTokens[settings.fallbackModel]).toBeDefined();
    }
  });

  it("explains every failure code to the user", () => {
    for (const code of ["TIMEOUT", "PROVIDER_ERROR", "PROVIDER_REJECTED", "INVALID_OUTPUT", "TRUNCATED", "FILE_MISSING", "NO_API_KEY", "WORKER_LOST"]) {
      const explained = explainFailure(code, 3);
      expect(explained.title).not.toBe("Something went wrong");
      expect(explained.body.length).toBeGreaterThan(30);
    }
  });
});
