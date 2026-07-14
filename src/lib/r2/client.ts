import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

export async function downloadFile(key: string): Promise<Buffer> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
  );
  if (!response.Body) throw new Error(`Empty body for key: ${key}`);
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteFile(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
}

export async function getPresignedUrl(key: string, expiresIn: number): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    { expiresIn },
  );
}

/**
 * Presigned direct-upload URL for browser -> R2. Signs the exact key + Content-Type,
 * so the browser PUT must send that same Content-Type header or R2 rejects the
 * signature — this is what prevents a client from silently swapping the file type
 * between presigning and upload.
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresIn: number,
): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export interface R2ObjectHead {
  contentLength: number;
  contentType: string | null;
}

/** Returns null (not throws) when the object does not exist — callers treat that as "not uploaded yet". */
export async function headFile(key: string): Promise<R2ObjectHead | null> {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
    return { contentLength: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (err as { name?: string }).name;
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return null;
    throw err;
  }
}

export interface R2ListedObject {
  key: string;
  lastModified: Date | null;
  size: number;
}

/** Lists every object under a prefix (paginated internally) — used only by the cleanup cron. */
export async function listObjectsByPrefix(prefix: string): Promise<R2ListedObject[]> {
  const results: R2ListedObject[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) results.push({ key: obj.Key, lastModified: obj.LastModified ?? null, size: obj.Size ?? 0 });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return results;
}
