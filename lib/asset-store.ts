import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const ASSET_DIR = join(process.cwd(), "public/assets");

// 디렉토리가 없으면 생성
if (!existsSync(ASSET_DIR)) {
  mkdirSync(ASSET_DIR, { recursive: true });
}

/**
 * issue #3: 업로드 파일을 asset:// 참조로 변환하는 계층
 * 로컬 스토리지를 사용하는 구현
 */

export interface AssetUploadResult {
  assetUri: string; // asset://<id> 형태
  filePath: string;
  originalName: string;
}

/**
 * 파일을 업로드하고 asset:// URI를 반환한다.
 * @param fileBuffer - 업로드된 파일의 버퍼
 * @param originalName - 원본 파일명
 * @param mimeType - 파일 MIME 타입
 */
export function uploadAsset(
  fileBuffer: Buffer,
  originalName: string
): AssetUploadResult {
  const assetId = randomUUID();
  const ext = originalName.split(".").pop() ?? "bin";
  const fileName = `${assetId}.${ext}`;
  const filePath = join(ASSET_DIR, fileName);

  writeFileSync(filePath, fileBuffer);

  return {
    assetUri: `asset://${assetId}`,
    filePath,
    originalName,
  };
}

/**
 * asset:// URI에서 실제 파일 경로를 가져온다.
 * @param assetUri - asset://<id> 또는 asset://<id>.<ext> 형태
 */
export function resolveAssetPath(assetUri: string): string | null {
  if (!assetUri.startsWith("asset://")) {
    return null;
  }

  const assetId = assetUri.replace("asset://", "");

  // 디렉토리에서 해당 ID로 시작하는 파일 찾기
  const files = existsSync(ASSET_DIR) ? readdirSync(ASSET_DIR) : [];
  const match = files.find((f: string) => f.startsWith(assetId));

  if (!match) {
    return null;
  }

  return join(ASSET_DIR, match);
}

/**
 * asset:// URI로 파일을 읽는다.
 */
export function readAsset(assetUri: string): Buffer | null {
  const filePath = resolveAssetPath(assetUri);
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath);
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
