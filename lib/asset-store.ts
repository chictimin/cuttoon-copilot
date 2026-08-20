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
  originalName?: string;
}

// issue #68/#72: 업로드 제한값. 버킷 설정(#68)과 라우트 검증(#72)이 같은 값을
// 쓰도록 여기 한 곳에 둔다 — 값이 바뀌면 여기만 고치면 된다.
// uploadAsset()을 부르는 곳이 app/api/upload/route.ts 하나뿐이고, 실제로
// 올라오는 건 레퍼런스 이미지뿐이라 이미지 3종으로 제한한다 (pdf/txt/json은
// 예전엔 getMimeType()에 매핑만 돼 있을 뿐 쓰는 곳이 없었음 — #68 확인 결과,
// #78에서 그 매핑 자체를 제거함).
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedUploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

export type UploadValidationError = {
  code: "too_large" | "unsupported_type" | "content_mismatch";
  message: string;
};

// #72: 코드 상수(MAX_UPLOAD_SIZE_BYTES/ALLOWED_UPLOAD_MIME_TYPES)와 버킷의 실제
// 설정이 서로 다른 곳(코드 vs Supabase 대시보드)에 있어서, 대시보드를 다시
// 만지면 같은 종류의 어긋남이 재발할 수 있다 — 실제로 한 번 일어났었다
// (버킷 10,000,000 vs 코드 10,485,760, 474KB 구간에서 400 대신 500이 나감).
// 부팅 시 한 번 실제 값을 읽어 대조하고, 다르면 경고만 남긴다. 이 검사는
// advisory일 뿐이라 업로드 요청을 막거나 지연시키지 않고, 실패해도(네트워크
// 문제 등) 조용히 건너뛴다.
async function warnIfBucketConfigDrifted(): Promise<void> {
  try {
    const { data, error } = await supabase.storage.getBucket(BUCKET_NAME);
    if (error || !data) {
      console.warn(
        `[asset-store] #72 드리프트 감지: 버킷 설정을 못 읽어 건너뜀 (${error?.message ?? "no data"})`
      );
      return;
    }

    if (data.file_size_limit != null && data.file_size_limit !== MAX_UPLOAD_SIZE_BYTES) {
      console.warn(
        `[asset-store] #72 드리프트: 버킷 file_size_limit(${data.file_size_limit})이 ` +
          `코드 MAX_UPLOAD_SIZE_BYTES(${MAX_UPLOAD_SIZE_BYTES})와 다릅니다 — ` +
          "두 값 사이 크기의 파일은 400 대신 500을 받습니다. 둘 중 하나를 맞춰주세요."
      );
    }

    const bucketMimeTypes = data.allowed_mime_types;
    if (bucketMimeTypes != null) {
      const codeSet = new Set<string>(ALLOWED_UPLOAD_MIME_TYPES);
      const bucketSet = new Set(bucketMimeTypes);
      const matches = codeSet.size === bucketSet.size && [...codeSet].every((t) => bucketSet.has(t));
      if (!matches) {
        console.warn(
          `[asset-store] #72 드리프트: 버킷 allowed_mime_types(${JSON.stringify(bucketMimeTypes)})가 ` +
            `코드 ALLOWED_UPLOAD_MIME_TYPES(${JSON.stringify(ALLOWED_UPLOAD_MIME_TYPES)})와 다릅니다.`
        );
      }
    }
  } catch (err) {
    console.warn("[asset-store] #72 드리프트 감지 중 예외 — 건너뜀:", err);
  }
}

void warnIfBucketConfigDrifted();

/**
 * 업로드 전 크기·타입을 확인한다. file.type은 클라이언트가 멀티파트 요청에 써
 * 보내는 문자열이라 그 자체로는 아무것도 증명하지 않는다 — 실제 내용 확인은
 * validateFileContent()가 한다(#78). 이 함수는 그 전에 값싸게 걸러내는 1차
 * 필터일 뿐이다.
 */
export function validateUpload(file: File): UploadValidationError | null {
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return { code: "too_large", message: "이미지는 10MB까지 올릴 수 있습니다" };
  }
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type as AllowedUploadMimeType)) {
    return { code: "unsupported_type", message: "PNG · JPG · WebP 이미지만 올릴 수 있습니다" };
  }
  return null;
}

// #78: 파일 확장자·선언된 file.type이 아니라 실제 바이트(매직바이트)로 판정한다.
// 확장자를 속여도(payload.svg를 image/png로 선언) 여기서 내용 자체를 확인하므로
// 통과하지 못한다.
const MAGIC_BYTE_CHECKS: Record<AllowedUploadMimeType, (buf: Buffer) => boolean> = {
  "image/png": (buf) =>
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a,
  "image/jpeg": (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  "image/webp": (buf) =>
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP",
};

/**
 * declaredType(validateUpload를 통과한 file.type)이 실제 파일 내용과 맞는지
 * 매직바이트로 확인한다. buffer를 다 읽은 뒤(라우트에서 이미 arrayBuffer로
 * 읽는 시점) 업로드 직전에 호출하는 걸 전제로 한다.
 */
export function validateFileContent(
  buffer: Buffer,
  declaredType: AllowedUploadMimeType
): UploadValidationError | null {
  if (!MAGIC_BYTE_CHECKS[declaredType](buffer)) {
    return {
      code: "content_mismatch",
      message: "파일 내용이 선언한 이미지 형식과 일치하지 않습니다",
    };
  }
  return null;
}

const EXTENSION_FOR_MIME: Record<AllowedUploadMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * 파일을 Supabase Storage에 업로드하고 asset:// URI를 반환한다.
 *
 * contentType은 validateUpload + validateFileContent를 모두 통과한 값이어야
 * 한다 — 저장 시 쓰는 확장자·contentType이 이 값 하나에서만 나오게 해서
 * (#78) "검증에 쓰는 필드와 저장에 쓰는 필드가 다른" 구조 자체를 없앤다.
 * originalName은 화면 표시용일 뿐 저장 로직에 영향을 주지 않는다.
 */
export async function uploadAsset(
  fileBuffer: Buffer,
  contentType: AllowedUploadMimeType,
  originalName?: string
): Promise<AssetUploadResult> {
  const assetId = randomUUID();
  const fileName = `${assetId}.${EXTENSION_FOR_MIME[contentType]}`;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, fileBuffer, {
      contentType,
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
