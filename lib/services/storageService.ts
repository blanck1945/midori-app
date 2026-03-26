import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import https from 'node:https'
import { config } from '../config'

let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    const options: ConstructorParameters<typeof S3Client>[0] = {
      region: 'auto',
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    }

    if (config.appEnv !== 'production') {
      options.requestHandler = new NodeHttpHandler({
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      })
    }

    _client = new S3Client(options)
  }
  return _client
}

/** dataUrl: "data:image/jpeg;base64,..." — devuelve URL pública en R2 */
export async function uploadImageFromDataUrl(dataUrl: string, key: string): Promise<string> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Formato de imagen inválido')

  const contentType = match[1]
  const buffer = Buffer.from(match[2], 'base64')

  await getClient().send(
    new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )

  return `${config.r2PublicUrl.replace(/\/$/, '')}/${key}`
}

/**
 * Extrae la clave S3 (`plants/.../archivo.jpg`) desde la URL guardada en BD.
 * Acepta path-style (`.../bucket/plants/...`) o URL pública (`.../plants/...` sin bucket en path).
 */
export function r2ObjectKeyFromStoredUrl(imageUrl: string): string | null {
  if (!imageUrl.startsWith('http')) return null
  try {
    const u = new URL(imageUrl)
    const path = u.pathname.replace(/^\//, '')
    const bucket = config.r2BucketName
    if (path.startsWith(`${bucket}/`)) {
      return path.slice(bucket.length + 1)
    }
    if (path.startsWith('plants/')) {
      return path
    }
    return null
  } catch {
    return null
  }
}

export async function getObjectBuffer(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  const out = await getClient().send(
    new GetObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
    }),
  )
  const body = out.Body
  if (!body) throw new Error('Objeto vacío en R2')

  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: out.ContentType ?? 'application/octet-stream',
  }
}
