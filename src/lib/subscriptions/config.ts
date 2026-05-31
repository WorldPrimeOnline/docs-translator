export const SUBSCRIPTION_PLANS = {
  basic: {
    name: 'Basic',
    priceKzt: 4990,
    documentsLimit: 10,
    priority: 0,
  },
  pro: {
    name: 'Pro',
    priceKzt: 12990,
    documentsLimit: 40,
    priority: 1,
  },
} as const;

export type PlanKey = keyof typeof SUBSCRIPTION_PLANS;

export const SUBSCRIPTION_DURATION_DAYS = 30;
