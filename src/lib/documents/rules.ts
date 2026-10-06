import { aiConfig } from "@/lib/ai/config";

// Upload rules shared by the browser (instant feedback) and the server (the
// real check). The server additionally inspects the bytes, which the browser
// cannot be trusted to do.

export const uploadRules = aiConfig.upload;
export const allowedExtensions = Object.keys(uploadRules.allowedTypes);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Checks that need only the file's name and size. Returns a reason, or null if acceptable. */
export function checkNameAndSize(name: string, size: number): string | null {
  if (!allowedExtensions.includes(extensionOf(name))) return `Only ${allowedExtensions.join(", ")} files are accepted.`;
  if (size === 0) return "This file is empty.";
  if (size > uploadRules.maxFileBytes) return `This file is larger than ${uploadRules.maxFileBytes / 1_000_000} MB.`;
  return null;
}
