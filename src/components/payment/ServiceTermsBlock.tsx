import { getTranslations } from 'next-intl/server';

interface Props {
  /** Render as a compact inline note rather than a full bordered block. */
  compact?: boolean;
}

export async function ServiceTermsBlock({ compact = false }: Props) {
  const t = await getTranslations('serviceTerms');

  if (compact) {
    return (
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
        {t('deliveryBody')}{' '}
        {t('cancellationBody')}
      </p>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6 rounded-lg border border-white/10 bg-card p-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{t('deliveryTitle')}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('deliveryBody')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('officialNote')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('notarizationNote')}</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{t('cancellationTitle')}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('cancellationBody')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('technicalFaultBody')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('poorQualityBody')}</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{t('reprocessingTitle')}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('reprocessingBody')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('reprocessingQualityLimit')}</p>
      </section>
    </div>
  );
}
