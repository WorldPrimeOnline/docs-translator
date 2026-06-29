import { z } from 'zod';

export const PARTNER_TYPES = [
  'translator',
  'notary',
  'agency',
  'visa_center',
  'migration_consultant',
  'education_agency',
  'legal_firm',
  'corporate',
  'other',
] as const;

export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PartnerApplicationSchema = z.object({
  partnerType: z.enum(PARTNER_TYPES),
  name: z.string().min(2, 'Name is required').max(200),
  email: z.string().email('Invalid email').max(255),
  phone: z.string().max(50).optional().or(z.literal('')),
  organization: z.string().max(500).optional().or(z.literal('')),
  message: z.string().max(2000).optional().or(z.literal('')),
  refCode: z.string().max(100).optional().or(z.literal('')),
  utmSource: z.string().max(200).optional().or(z.literal('')),
  utmMedium: z.string().max(200).optional().or(z.literal('')),
  utmCampaign: z.string().max(200).optional().or(z.literal('')),
});

export type PartnerApplicationInput = z.infer<typeof PartnerApplicationSchema>;
