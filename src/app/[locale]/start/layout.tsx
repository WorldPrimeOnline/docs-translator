// Mirrors src/app/[locale]/dashboard/layout.tsx exactly — the public order form must use
// the same container width/typography as the dashboard order form, since both render the
// same OrderForm component.
export default function StartLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
