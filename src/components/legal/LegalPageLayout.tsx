import type { LegalDocument } from '@/lib/legal/types';

interface LegalPageLayoutProps {
  doc: LegalDocument;
}

export function LegalPageLayout({ doc }: LegalPageLayoutProps) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      {/* Header */}
      <header className="mb-10 border-b border-white/10 pb-8">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{doc.title}</h1>
        {doc.effectiveDate && (
          <p className="mt-3 text-sm text-muted-foreground">{doc.effectiveDate}</p>
        )}
      </header>

      {/* Table of Contents */}
      {doc.sections.length > 3 && (
        <nav className="mb-10 rounded-lg border border-white/10 bg-card p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Contents
          </p>
          <ol className="flex flex-col gap-1.5">
            {doc.sections.filter((s) => s.id !== 'contact' && s.id !== 'contacts').map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {/* Sections */}
      <div className="flex flex-col gap-10">
        {doc.sections.filter((s) => s.id !== 'contact' && s.id !== 'contacts').map((section) => (
          <section key={section.id} id={section.id}>
            <h2 className="mb-4 text-base font-semibold text-foreground sm:text-lg">
              {section.heading}
            </h2>
            <div className="flex flex-col gap-3">
              {section.body.map((item, i) => {
                if (item.startsWith('•')) {
                  return (
                    <div key={i} className="flex gap-2.5">
                      <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {item.slice(1).trim()}
                      </p>
                    </div>
                  );
                }
                return (
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                    {item}
                  </p>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
