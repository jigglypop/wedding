import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Material } from '../src/types';
import { HttpError, localDir } from './db';

const bucket = process.env.MATERIALS_BUCKET;
const s3 = bucket ? new S3Client({}) : null;
export const remoteFiles = !!s3;
export const mimeByExtension:Record<string, string> = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.pdf':'application/pdf', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls':'application/vnd.ms-excel', '.csv':'text/csv', '.txt':'text/plain' };

export function assertSafeKey(filename:string) {
  if (!filename || filename.includes('..') || filename.startsWith('/') || filename.includes('\\')) throw new HttpError(400, '잘못된 자료 경로입니다.');
  return filename;
}
export const mimeOf = (material:Material, filename = material.filename || '') => material.mimeType || mimeByExtension[extname(filename).toLowerCase()] || 'application/octet-stream';
const localPath = (filename:string, upload:boolean) => upload ? resolve(localDir(), 'assets', filename) : resolve(process.env.DATA_DIR || 'data', 'assets', filename);

export async function saveUpload(filename:string, data:Buffer, contentType:string) {
  assertSafeKey(filename);
  if (s3) { await s3.send(new PutObjectCommand({ Bucket:bucket, Key:filename, Body:data, ContentType:contentType, ServerSideEncryption:'AES256' })); return; }
  const file = localPath(filename, true); await mkdir(dirname(file), { recursive:true }); await writeFile(file, data);
}
export async function deleteUpload(filename:string) {
  assertSafeKey(filename);
  if (s3) { await s3.send(new DeleteObjectCommand({ Bucket:bucket, Key:filename })); return; }
  await rm(localPath(filename, true), { force:true });
}
export async function signedUrl(filename:string, contentType:string, seconds:number, downloadName?:string) {
  const disposition = downloadName ? `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}` : undefined;
  return getSignedUrl(s3!, new GetObjectCommand({ Bucket:bucket, Key:assertSafeKey(filename), ResponseContentType:contentType, ResponseContentDisposition:disposition }), { expiresIn:seconds });
}
const signatures:Record<string, (data:Buffer) => boolean> = {
  '.jpg':d => d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff, '.jpeg':d => d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff,
  '.png':d => d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.webp':d => d.subarray(0, 4).toString('latin1') === 'RIFF' && d.subarray(8, 12).toString('latin1') === 'WEBP',
  '.pdf':d => d.subarray(0, 5).toString('latin1') === '%PDF-', '.xlsx':d => d.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  '.xls':d => d.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  '.csv':d => !d.subarray(0, 4096).includes(0), '.txt':d => !d.subarray(0, 4096).includes(0)
};
export const matchesSignature = (extension:string, data:Buffer) => !!signatures[extension]?.(data);
export async function readLocalFile(filename:string, upload:boolean) { return readFile(localPath(assertSafeKey(filename), upload)); }
