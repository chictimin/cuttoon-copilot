import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase 환경 변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET_NAME = "assets";

/**
 * issue #3: 업로드 파일을 asset:// 참조로 변환하는 계층
 * Supabase Storage를 사용하는 구현
 */

export interface AssetUploadResult {
  assetUri: string;
  path: string;
  originalName: string;
}

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    json: "application/json",
  };
  return mimeTypes[ext.toLowerCase()] || "application/octet-stream";
}

/**
 * 파일을 Supabase Storage에 업로드하고 asset:// URI를 반환한다.
 */
export async function uploadAsset(
  fileBuffer: Buffer,
  originalName: string
): Promise<AssetUploadResult> {
  const assetId = randomUUID();
  const ext = originalName.split(".").pop() ?? "bin";
  const fileName = `${assetId}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, fileBuffer, {
      contentType: getMimeType(ext),
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase 업로드 실패: ${error.message}`);
  }

  return {
    assetUri: `asset://${assetId}`,
    path: `${BUCKET_NAME}/${fileName}`,
    originalName,
  };
}

/**
 * Supabase Storage에서 공개 URL을 반환한다.
 * list()로 실제 저장된 파일을 먼저 확인한 후 URL을 생성한다.
 */
export async function getAssetUrl(assetUri: string): Promise<string | null> {
  if (!assetUri.startsWith("asset://")) {
    return null;
  }

  const assetId = assetUri.replace("asset://", "");

  // 실제 저장된 파일 찾기
  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET_NAME)
    .list("", { search: assetId });

  if (listError || !files || files.length === 0) {
    return null;
  }

  // 첫 번째 매칭 파일의 공개 URL 생성
  const fileName = files[0].name;
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fileName);

  return data?.publicUrl ?? null;
}

/**
 * Supabase Storage에서 파일을 읽는다.
 */
export async function readAsset(assetUri: string): Promise<Buffer | null> {
  if (!assetUri.startsWith("asset://")) {
    return null;
  }

  const assetId = assetUri.replace("asset://", "");
  const extensions = ["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "txt", "json"];

  for (const ext of extensions) {
    const fileName = `${assetId}.${ext}`;
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(fileName);

    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
  }

  return null;
}

/**
 * asset:// URI가 유효한지 확인한다.
 */
export function isValidAssetUri(uri: string): boolean {
  if (!uri.startsWith("asset://")) {
    return false;
  }
  const assetId = uri.replace("asset://", "");
  return assetId.length > 0 && /^[a-f0-9-]+$/i.test(assetId);
}
