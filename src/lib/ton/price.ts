let cache: { price: number; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getTonPriceUsd(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.price;

  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

  const data = (await res.json()) as { 'the-open-network': { usd: number } };
  const price = data['the-open-network'].usd;
  cache = { price, at: now };
  return price;
}

export function usdToNanoton(usd: number, tonPriceUsd: number): number {
  return Math.ceil((usd / tonPriceUsd) * 1e9);
}
