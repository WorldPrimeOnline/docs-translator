import { Polar } from '@polar-sh/sdk';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export function getPolarClient(): Polar {
  return new Polar({ accessToken: requireEnv('POLAR_API_KEY') });
}

export function getPolarProductId(documentType: string, pageCount: number): string {
  const small = requireEnv('POLAR_PRODUCT_ID_SMALL');

  if (documentType === 'passport' || documentType === 'driver_license') {
    return process.env.POLAR_PRODUCT_ID_PASSPORT ?? small;
  }
  if (pageCount > 15) {
    return process.env.POLAR_PRODUCT_ID_LARGE ?? small;
  }
  if (pageCount > 5) {
    return process.env.POLAR_PRODUCT_ID_MEDIUM ?? small;
  }
  return small;
}
