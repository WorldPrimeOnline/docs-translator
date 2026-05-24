const TONCENTER_URL = 'https://toncenter.com/api/v2/getTransactions';

interface ToncenterTx {
  utime: number;
  in_msg: {
    value: string;
    message: string;
  };
}

interface ToncenterResponse {
  ok: boolean;
  result: ToncenterTx[];
}

export async function verifyTonPayment(params: {
  address: string;
  amountNanoton: number;
  memo: string;
  createdAtSec: number;
  expiresAtSec: number;
}): Promise<{ verified: boolean; txHash?: string }> {
  const { address, amountNanoton, memo, createdAtSec, expiresAtSec } = params;

  const url = new URL(TONCENTER_URL);
  url.searchParams.set('address', address);
  url.searchParams.set('limit', '20');

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return { verified: false };

  const data = (await res.json()) as ToncenterResponse;
  if (!data.ok || !Array.isArray(data.result)) return { verified: false };

  const minAmount = Math.floor(amountNanoton * 0.99);

  for (const tx of data.result) {
    if (tx.utime < createdAtSec || tx.utime > expiresAtSec) continue;
    if (tx.in_msg.message !== memo) continue;
    if (Number(tx.in_msg.value) < minAmount) continue;
    return { verified: true };
  }

  return { verified: false };
}
