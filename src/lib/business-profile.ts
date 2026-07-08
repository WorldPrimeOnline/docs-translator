export interface BusinessProfile {
  /** Registered legal name in Kazakh/Russian (used in RU-facing documents and footer) */
  legalName: string;
  /** Latin-script legal name (used in EN-facing documents and acquiring forms) */
  latinName: string;
  iinBin: string;
  /** Legal / postal address — REQUIRED for Halyk Bank acquiring approval */
  legalAddress: string;
  phone: string;
  email: string;
  website: string;
  /**
   * True once Halyk ePay card payment gateway credentials are configured
   * and the integration is live. Controls wording in PaymentComplianceBlock.
   * false → "will be processed through Halyk ePay" (pending)
   * true  → "are processed through Halyk ePay" (active)
   */
  cardPaymentsActive: boolean;
}

export const BUSINESS_PROFILE: BusinessProfile = {
  legalName: 'ИП WorldPrimeOnline',
  latinName: 'IE WorldPrimeOnline',
  iinBin: '840324300155',
  legalAddress: 'г. Алматы',
  phone: '+77011366376',
  email: 'worldprimeonline@gmail.com',
  website: 'https://wpotranslations.org',
  // Halyk ePay gateway credentials are configured in env and the integration is live.
  cardPaymentsActive: true,
};
