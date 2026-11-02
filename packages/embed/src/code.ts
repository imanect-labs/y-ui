/**
 * ui ブロックのソースを URL に入れられる短い文字列にする（deflate-raw → base64url、詰め物なし）。
 *
 * Web 標準の CompressionStream だけを使うので、Node（20.12 以降）でも Cloudflare Workers でも
 * ブラウザでも同じ結果になる。
 */

/** 復元したソースの上限（バイト）。圧縮爆弾で Worker のメモリを使い切らないように。 */
export const MAX_SOURCE_BYTES = 64 * 1024;
/** 受け付けるコードの長さの上限（文字）。 */
export const MAX_CODE_LENGTH = 32 * 1024;

const CODE = /^[A-Za-z0-9_-]+$/;

export class CodeError extends Error {
  override name = "CodeError";
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): Uint8Array<ArrayBuffer> {
  const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new CodeError(`ソースが大きすぎます（${limit} バイトまで）`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** ソースをコードにする。 */
export async function encodeSource(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new CodeError(`ソースが大きすぎます（${MAX_SOURCE_BYTES} バイトまで）`);
  const deflated = await readAll(streamOf(bytes).pipeThrough(new CompressionStream("deflate-raw")), Infinity);
  return toBase64Url(deflated);
}

/** コードをソースに戻す。壊れたコード・大きすぎるコードは CodeError。 */
export async function decodeSource(code: string): Promise<string> {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH || !CODE.test(code)) throw new CodeError("コードの形が正しくありません");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64Url(code);
  } catch {
    throw new CodeError("コードの形が正しくありません");
  }
  let inflated: Uint8Array;
  try {
    inflated = await readAll(streamOf(bytes).pipeThrough(new DecompressionStream("deflate-raw")), MAX_SOURCE_BYTES);
  } catch (e) {
    if (e instanceof CodeError) throw e;
    throw new CodeError("コードを展開できません");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(inflated);
  } catch {
    throw new CodeError("コードの中身が UTF-8 ではありません");
  }
}
