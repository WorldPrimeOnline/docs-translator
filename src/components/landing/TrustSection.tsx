import { getTranslations } from 'next-intl/server';
import { Zap, BadgeDollarSign, Coins, Lock, AlertCircle } from 'lucide-react';

interface Props {
  headline?: string;
}

export async function TrustSection({ headline }: Props) {
  const t = await getTranslations();

  const items = [
    { icon: Zap,             title: t('trust.speed'),    desc: t('trust.speedDesc')    },
    { icon: BadgeDollarSign, title: t('trust.price'),    desc: t('trust.priceDesc')    },
    { icon: Coins,           title: t('trust.ton'),      desc: t('trust.tonDesc')      },
    { icon: Lock,            title: t('trust.security'), desc: t('trust.securityDesc') },
    { icon: AlertCircle,     title: t('trust.informal'), desc: t('trust.informalDesc') },
  ];

  const sectionHeadline = headline ?? t('trust.title');

  return (
    <section className="px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            {t('landing.trustLabel')}
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {sectionHeadline}
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, 3).map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-lg border border-white/10 bg-card p-5 transition-colors hover:border-white/15"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {items.slice(3).map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-lg border border-white/10 bg-card p-5 transition-colors hover:border-white/15"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-white/10 bg-card px-5 py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground/70">Disclaimer: </span>
            {t('landing.trustDisclaimer')}
          </p>
        </div>
      </div>
    </section>
  );
}
