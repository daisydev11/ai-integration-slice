import Link from "next/link";

export default function NotFound() {
  return (
    <div className="centered">
      <main className="card stack">
        <h1>That page does not exist</h1>
        <p className="lede">It may belong to another account, or the address may be mistyped.</p>
        <Link href="/documents">Go to your documents</Link>
      </main>
    </div>
  );
}
