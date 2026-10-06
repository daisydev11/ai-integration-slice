// Screens reused from Assessment 1 (authentication), centred in a card.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="centered">
      <main className="card">{children}</main>
    </div>
  );
}
