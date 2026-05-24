export async function GET() {
  return Response.json({
    POLAR_API_KEY: !!process.env.POLAR_API_KEY,
    POLAR_PRODUCT_ID_SMALL: !!process.env.POLAR_PRODUCT_ID_SMALL,
    POLAR_WEBHOOK_SECRET: !!process.env.POLAR_WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
  });
}
