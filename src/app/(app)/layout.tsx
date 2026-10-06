import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getSessionUser } from "@/lib/auth/session";

// Minimal signed-in shell. Authentication is reused from Assessment 1.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return (
    <div className="shell">
      <header className="shell-header">
        <nav aria-label="Main">
          <Link href="/documents">Job descriptions</Link>
        </nav>
        <div className="shell-user">
          <span>{user.name}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}
