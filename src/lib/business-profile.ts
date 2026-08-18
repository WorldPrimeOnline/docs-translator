export interface BusinessProfile {
  /** Registered legal name in Kazakh/Russian (used in RU-facing documents and footer) */
  legalName: string;
  /** Latin-script legal name (used in EN-facing documents and acquiring forms) */
  latinName: string;
  iinBin: string;
  /** Legal / postal address */
  legalAddress: string;
  /** Intentionally empty — no public phone number is published. Do not repopulate without instruction. */
  phone: string;
  email: string;
  website: string;
  /**
   * True once Halyk ePay card payment gateway credentials are configured
   * and the integration is live for THIS entity. Controls wording in
   * PaymentComplianceBlock. Halyk acquiring has not yet been migrated to
   * the current legal entity — keep false until it has.
   * false → payments-unavailable wording
   * true  → "are processed through Halyk ePay" (active)
   */
  cardPaymentsActive: boolean;
}

// Legal entity changed 2026-08: the previous sole proprietorship (ИП/IE WorldPrimeOnline,
// IIN 840324300155) was replaced by the registered ТОО below. Halyk ePay acquiring has
// not been migrated to the new entity yet — see cardPaymentsActive and
// docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md.
export const BUSINESS_PROFILE: BusinessProfile = {
  legalName: 'ТОО World Prime Online',
  latinName: 'TOO World Prime Online',
  iinBin: '260840011541',
  legalAddress: 'Казахстан, город Алматы, Ауэзовский район, улица Рыскулбекова, дом 39А, почтовый индекс 050042',
  phone: '',
  email: 'wpotranslations@gmail.com',
  website: 'https://wpotranslations.org',
  cardPaymentsActive: false,
};
