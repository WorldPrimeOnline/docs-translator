import { getTranslations } from 'next-intl/server';
import { Zap, Lock, Cpu, CreditCard, Server, Trash2, Eye, Shield } from 'lucide-react';

interface Props {
  headline?: string;
  mode?: 'features' | 'security';
}

export async function TrustSection({ headline, mode = 'features' }: Props) {
  const t = await getTranslations();

  const featureItems = [
    { icon: Zap,    title: t('trust.speed'),    desc: t('trust.speedDesc') },
    { icon: Lock,   title: t('trust.security'), desc: t('trust.securityDesc') },
    { icon: Cpu,    title: t('trust.pillar2Title'), desc: t('trust.pillar2Body') },
    { icon: CreditCard, title: t('trust.payment'), desc: t('trust.paymentDesc') },
  ];

  const securityItems = [
    { icon: Server, title: t('security.item1Title'), desc: t('security.item1Desc') },
    { icon: Trash2, title: t('security.item2Title'), desc: t('security.item2Desc') },
    { icon: Eye,    title: t('security.item3Title'), desc: t('security.item3Desc') },
    { icon: Shield, title: t('security.item4Title'), desc: t('security.item4Desc') },
  ];

  const items = mode === 'security' ? securityItems : featureItems;
  const sectionHeadline = headline ?? (mode === 'security' ? t('security.title') : t('trust.title'));
  const eyebrow = mode === 'security' ? t('security.label') : t('trust.label');

  return (
    <section className="px-4 py-16 lg:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
            {eyebrow}
          </p>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
            {sectionHeadline}
          </h2>
          {mode === 'security' && (
            <p className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {t('security.subtitle')}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-card p-5 transition-all duration-200 hover:border-white/15 hover:shadow-[0_0_20px_rgba(0,0,0,0.2)]"
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.025] to-transparent" />
              <div className="relative">
                <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/8 ring-1 ring-primary/15">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="mb-1.5 text-sm font-semibold text-foreground">{title}</h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
