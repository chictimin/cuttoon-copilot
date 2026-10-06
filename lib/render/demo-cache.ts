// #239·#240: 발표용 데모 캐시(public/demo-cache/) 이미지를 Export가 읽는 계층.
//
// 캐시 경로로 만든 세션은 generated_image에 asset:// 대신 public 경로("/demo-cache/cover-1.png")를
// 저장한다(#240 10-06 결정). readAsset()은 asset://만 읽으므로, 이 값은 여기서 읽는다.
//
// 읽는 범위는 manifest.json의 covers·cuts에 글자 그대로 적힌 값뿐이다. 받은 값을 파일 경로로
// 이어 붙이지 않고 manifest 목록과 정확히 일치하는지만 보므로 "../" 같은 값으로 다른 파일을 열 수
// 없다. manifest가 없거나 깨졌으면 캐시가 없는 것으로 보고 null — Export는 그 컷을 건너뛴다.

import { readFile } from "node:fs/promises";
import path from "node:path";

export const DEMO_CACHE_PREFIX = "/demo-cache/";

// manifest에 적힌 값도 이 모양(폴더 바로 아래 이미지 파일 하나)일 때만 받는다 — manifest가
// 잘못 써져도 public/demo-cache/ 밖은 읽지 않는다.
const CACHE_REF = /^\/demo-cache\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp)$/;

export function isDemoCacheRef(value: string): boolean {
  return value.startsWith(DEMO_CACHE_PREFIX);
}

/** manifest(joniverse-ai 안, #240)에서 읽어도 되는 이미지 값 목록을 뽑는다. covers 배열 + cuts 객체 값. */
export function manifestImageRefs(manifest: unknown): Set<string> {
  const refs = new Set<string>();
  if (typeof manifest !== "object" || manifest === null) return refs;
  const { covers, cuts } = manifest as { covers?: unknown; cuts?: unknown };
  const candidates = [
    ...(Array.isArray(covers) ? covers : []),
    ...(typeof cuts === "object" && cuts !== null && !Array.isArray(cuts) ? Object.values(cuts) : []),
  ];
  for (const value of candidates) {
    if (typeof value === "string" && CACHE_REF.test(value)) refs.add(value);
  }
  return refs;
}

/**
 * 캐시 이미지를 읽는다. manifest 목록에 없는 값·읽기 실패는 null(던지지 않는다).
 * publicDir은 demo가 임시 폴더를 넘길 때만 쓴다 — 기본은 실행 위치의 public/.
 */
export async function readDemoCacheImage(
  ref: string,
  publicDir: string = path.join(process.cwd(), "public")
): Promise<Buffer | null> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(path.join(publicDir, "demo-cache", "manifest.json"), "utf8"));
  } catch (err) {
    console.warn("[demo-cache] manifest.json을 읽지 못했습니다 — 캐시 이미지 없이 진행합니다:", (err as Error).message);
    return null;
  }
  if (!manifestImageRefs(manifest).has(ref)) {
    console.warn(`[demo-cache] manifest에 없는 값이라 읽지 않습니다: ${ref}`);
    return null;
  }
  try {
    return await readFile(path.join(publicDir, "demo-cache", path.posix.basename(ref)));
  } catch (err) {
    console.warn(`[demo-cache] 캐시 이미지를 읽지 못했습니다: ${ref}`, (err as Error).message);
    return null;
  }
}
