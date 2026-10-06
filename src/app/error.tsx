"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="centered">
      <main className="card stack">
        <h1>Something went wrong on our side</h1>
        <p className="lede">Your uploaded files and any finished results are safe.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
        <Link href="/documents">Go to your documents</Link>
      </main>
    </div>
  );
}
