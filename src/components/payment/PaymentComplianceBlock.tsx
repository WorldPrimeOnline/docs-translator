import { getTranslations } from 'next-intl/server';
import { BUSINESS_PROFILE } from '@/lib/business-profile';

// TODO (REQUIRED BEFORE PRODUCTION — see public/payment-logos/README.md):
// Replace ALL placeholder SVG logos with official brand assets.
// The placeholder SVGs are text-only rectangles — they must NOT be used in production.
//
// Halyk ePay:  Get official informer from Halyk Bank partner portal.
//              The logo MUST link to http://epay.homebank.kz/.
// Visa:        https://usa.visa.com/run-your-business/merchant-logos.html
// Mastercard:  https://brand.mastercard.com/brandcenter/more-about-our-brands.html

function HalykEpayLogo() {
  // TODO: Replace with official Halyk ePay informer asset (see public/payment-logos/README.md).
  return (
    <svg
      width="96"
      height="34"
      viewBox="0 0 96 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Halyk ePay"
    >
      <rect width="96" height="34" rx="5" fill="#00A651" />
      <text x="48" y="13" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">HALYK</text>
      <text x="48" y="25" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">ePay</text>
    </svg>
  );
}

function VisaLogo() {
  // TODO: Replace with official Visa Acceptance Mark (see public/payment-logos/README.md).
  return (
    <svg
      width="58"
      height="34"
      viewBox="0 0 58 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Visa"
    >
      <rect width="58" height="34" rx="5" fill="#1434CB" />
      <text x="29" y="22" textAnchor="middle" fill="white" fontSize="15" fontWeight="bold" fontFamily="serif" letterSpacing="1">VISA</text>
    </svg>
  );
}

function MastercardLogo() {
  // TODO: Replace with official Mastercard Acceptance Mark (see public/payment-logos/README.md).
  return (
    <svg
      width="54"
      height="34"
      viewBox="0 0 54 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Mastercard"
    >
      <rect width="54" height="34" rx="5" fill="#252525" />
      <circle cx="20" cy="17" r="10" fill="#EB001B" />
      <circle cx="34" cy="17" r="10" fill="#F79E1B" />
      <path d="M27 8.27a10 10 0 0 1 0 17.46A10 10 0 0 1 27 8.27z" fill="#FF5F00" />
    </svg>
  );
}

export async function PaymentComplianceBlock() {
  const t = await getTranslations('paymentCompliance');

  // Use pending wording until the gateway is live in production.
  const processedByKey = BUSINESS_PROFILE.cardPaymentsActive ? 'processedBy' : 'processedByPending';

  return (
    <div className="border-t border-white/10 pt-6">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {t('title')}
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Halyk ePay logo — must link to http://epay.homebank.kz/ per Halyk Bank requirements */}
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
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {t(processedByKey)}
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {t('threeDSecure')}
        </p>
        <p className="text-xs text-muted-foreground/70">{t('deliveryCost')}</p>
        <p className="text-xs text-muted-foreground/70">{t('vatStatus')}</p>
      </div>
    </div>
  );
}
