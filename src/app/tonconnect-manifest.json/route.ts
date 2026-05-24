export async function GET() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return Response.json(
    {
      url: siteUrl,
      name: 'Docs Translator',
      iconUrl: `${siteUrl}/icon.png`,
    },
    { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } },
  );
}
