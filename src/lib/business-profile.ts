export interface BusinessProfile {
  legalName: string;
  iinBin: string;
  legalAddress: string;
  phone: string;
  email: string;
  website: string;
}

// TODO (REQUIRED BEFORE PRODUCTION — Halyk Bank acquiring compliance):
// Fill in every placeholder field.  These values appear on the Contacts page,
// in the footer, and in legal documents, and are required for internet acquiring
// approval by Halyk Bank.
export const BUSINESS_PROFILE: BusinessProfile = {
  legalName: 'TODO: ИП ФИО / ТОО Название',
  iinBin: 'TODO: ИИН/БИН',
  legalAddress: 'TODO: Юридический / почтовый адрес',
  phone: 'TODO: телефон для контактов и споров',
  email: 'worldprimeonline@gmail.com',
  website: 'https://wpotranslations.org',
};
