"use client";

import { useEffect, useState } from "react";

/**
 * Keeps server data fresh while work is in progress. Polls `url` every two
 * seconds for as long as `shouldPoll(data)` is true, and stops when it is not.
 */
export function usePolling<T>(url: string, initial: T, pick: (json: unknown) => T | undefined, shouldPoll: (data: T) => boolean): T {
  const [data, setData] = useState(initial);
  // New server-rendered data (after router.refresh) replaces what we hold.
  useEffect(() => setData(initial), [initial]);

  const active = shouldPoll(data);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return;
        const next = pick(await response.json());
        if (next !== undefined) setData(next);
      } catch {
        // offline for a moment: keep showing the last known state
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [active, url, pick]);

  return data;
}
