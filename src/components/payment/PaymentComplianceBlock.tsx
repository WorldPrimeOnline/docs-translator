import { getTranslations } from 'next-intl/server';
import { BUSINESS_PROFILE } from '@/lib/business-profile';

// TODO (REQUIRED BEFORE PRODUCTION — see public/payment-logos/README.md):
// Replace ALL placeholder SVG logos with official brand assets.
// Place official files at:
//   public/payment-logos/halyk-epay.svg   — from Halyk Bank partner portal
//   public/payment-logos/visa.svg         — from https://usa.visa.com/run-your-business/merchant-logos.html
//   public/payment-logos/mastercard.svg   — from https://brand.mastercard.com/

function HalykEpayLogo() {
  // TODO: Replace with official Halyk ePay informer (see public/payment-logos/README.md).
  return (
    <svg width="80" height="28" viewBox="0 0 80 28" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Halyk ePay">
      <rect width="80" height="28" rx="4" fill="#00A651" />
      <text x="40" y="11" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="sans-serif">HALYK</text>
      <text x="40" y="21" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="sans-serif">ePay</text>
    </svg>
  );
}

function VisaLogo() {
  // TODO: Replace with official Visa Acceptance Mark (see public/payment-logos/README.md).
  return (
    <svg width="48" height="28" viewBox="0 0 48 28" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Visa">
      <rect width="48" height="28" rx="4" fill="#1434CB" />
      <text x="24" y="19" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="serif" letterSpacing="1">VISA</text>
    </svg>
  );
}

function MastercardLogo() {
  // TODO: Replace with official Mastercard Acceptance Mark (see public/payment-logos/README.md).
  return (
    <svg width="44" height="28" viewBox="0 0 44 28" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mastercard">
      <rect width="44" height="28" rx="4" fill="#252525" />
      <circle cx="16" cy="14" r="8" fill="#EB001B" />
      <circle cx="28" cy="14" r="8" fill="#F79E1B" />
      <path d="M22 7.2a8 8 0 0 1 0 13.6A8 8 0 0 1 22 7.2z" fill="#FF5F00" />
    </svg>
  );
}

interface Props {
  /**
   * 'footer-column' — renders without outer border/padding wrapper, fits inside footer grid column.
   * 'standalone'    — renders with border-t and padding (default, used on /contacts page).
   */
  variant?: 'standalone' | 'footer-column';
}

export async function PaymentComplianceBlock({ variant = 'standalone' }: Props) {
  const t = await getTranslations('paymentCompliance');
  const processedByKey = BUSINESS_PROFILE.cardPaymentsActive ? 'processedBy' : 'processedByPending';

  const inner = (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Halyk ePay logo — MUST link to http://epay.homebank.kz/ per Halyk Bank requirements */}
        <a
          href="http://epay.homebank.kz/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Halyk ePay — internet acquiring"
          className="opacity-90 transition-opacity hover:opacity-100"
        >
          <HalykEpayLogo />
        </a>
        <VisaLogo />
        <MastercardLogo />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t(processedByKey)}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('threeDSecure')}</p>
      <p className="text-xs text-muted-foreground/70">{t('deliveryCost')}</p>
      <p className="text-xs text-muted-foreground/70">{t('vatStatus')}</p>
    </div>
  );

  if (variant === 'footer-column') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
          {t('title')}
        </p>
        {inner}
      </div>
    );
  }

  return (
    <div className="border-t border-white/10 pt-6">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {t('title')}
      </p>
      {inner}
    </div>
  );
}
