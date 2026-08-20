import { getAssetUrl } from "@/lib/asset-store";

// GET /api/session/asset-url?uri=asset://...
//
// issue #82: 세션 화면이 실제 생성 결과(asset:// 참조)를 <img>로 그리려면 공개
// URL이 필요하다. getAssetUrl()(lib/asset-store.ts, 서비스 롤 키 사용)은
// 서버에서만 부를 수 있어 클라이언트가 직접 호출하지 못한다 — 이 라우트가
// 그 사이를 잇는 얇은 리졸버다. 저장되는 storyboard.cuts[].generated_image는
// 계속 asset:// 그대로 유지하고(스키마 pattern ^asset://), 화면 표시용
// URL만 이 라우트로 따로 받는다.

// asset:// 뒤의 자산 ID는 uploadAsset()의 randomUUID() 결과다(lib/asset-store.ts).
// 그 형식으로 못 박아 확인한다.
//
// 이 검증이 없으면 인증 없이 버킷 자산을 열거할 수 있다. getAssetUrl()이
// Storage를 list({ search: assetId }) — 부분 문자열 검색 — 으로 찾고 files[0]을
// 돌려주기 때문이다. 실측:
//   ?uri=asset://a   → 200 + 실제 자산 공개 URL
//   ?uri=asset://    → 200 + 임의 자산 공개 URL (search:"" 가 전체 목록이 된다)
//
// isValidAssetUri()(asset-store.ts)를 쓰지 않는 이유는 그쪽이 /^[a-f0-9-]+$/i 에
// 길이 하한만 두어 `asset://a` 를 통과시키기 때문이다. 근본 수정은 getAssetUrl()이
// 부분 매칭 대신 정확 일치로 찾는 것이지만 그 파일은 B 소유라, 여기서는 입력 쪽을
// 좁혀 막는다.
const ASSET_UUID_URI =
  /^asset:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const uri = new URL(request.url).searchParams.get("uri");
  if (!uri) {
    return Response.json({ error: "uri 쿼리가 필요합니다" }, { status: 400 });
  }

  // 형식 위반은 400으로 끊는다 — 404로 주면 "형식은 맞는데 없는 자산"과
  // 구분되지 않아 존재 여부를 떠보는 데 쓸 수 있다.
  if (!ASSET_UUID_URI.test(uri)) {
    return Response.json({ error: "uri 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const url = await getAssetUrl(uri);
  if (!url) {
    return Response.json({ error: "자산을 찾을 수 없습니다" }, { status: 404 });
  }

  return Response.json({ url });
}
