// asset:// 참조를 브라우저가 그릴 수 있는 공개 URL로 바꾸는 클라이언트 유틸 (#144).
// 화면 4곳(EditorFlow·SessionFlow·generate-client·ProjectSessions)에 같은 fetch가
// 따로 구현돼 있던 것을 한 곳으로 모은다.
//
// 실패 방침은 호출하는 화면이 정한다 — 이 유틸은 항상 throw한다.
//  - 한 장을 못 그리면 문제가 드러나야 하는 곳(이미지 생성 직후): 그대로 throw를 받는다.
//  - 목록·복원처럼 하나가 비어도 나머지가 보여야 하는 곳: 호출부에서 try/catch로 null 처리.

const ASSET_URL_ROUTE = "/api/session/asset-url";

/** asset:// 참조를 /api/session/asset-url로 리졸브한다. 실패하면 throw. */
export async function fetchAssetUrl(uri: string): Promise<string> {
  const res = await fetch(`${ASSET_URL_ROUTE}?uri=${encodeURIComponent(uri)}`);
  if (!res.ok) throw new Error("이미지 URL을 가져오지 못했습니다");
  const { url } = (await res.json()) as { url: string };
  return url;
}

/**
 * 저장된 이미지 값을 <img>에 쓸 수 있는 URL로 바꾼다.
 * issue #82 이후 asset:// 참조를 저장하지만, 그 이전 mock 시절 세션은 data: URI를
 * 그대로 저장해뒀을 수 있다. asset:// 형식이 아닌 값을 리졸버에 보내면 400이라
 * 그 값은 리졸브 없이 그대로 쓴다(레거시 호환).
 */
export async function resolveImageUrl(uri: string): Promise<string> {
  if (!uri.startsWith("asset://")) return uri;
  return fetchAssetUrl(uri);
}
