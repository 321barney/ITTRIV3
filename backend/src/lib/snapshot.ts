import { redis } from './redis';

export async function saveSellerSnapshot(sellerId: string, payload: object) {
  await redis.set(
    `seller:snapshot:${sellerId}`,
    JSON.stringify({ at: new Date().toISOString(), data: payload }),
    'EX',
    60 * 60 * 24
  ).catch(() => {});
}

export async function loadSellerSnapshot(sellerId: string) {
  const raw = await redis.get(`seller:snapshot:${sellerId}`).catch(() => null);
  return raw ? JSON.parse(raw) : null;
}
