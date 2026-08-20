import { getAssetUrl } from "@/lib/asset-store";

// GET /session/asset-url?uri=asset://...
//
// issue #82: 세션 화면이 실제 생성 결과(asset:// 참조)를 <img>로 그리려면 공개
// URL이 필요하다. getAssetUrl()(lib/asset-store.ts, 서비스 롤 키 사용)은
// 서버에서만 부를 수 있어 클라이언트가 직접 호출하지 못한다 — 이 라우트가
// 그 사이를 잇는 얇은 리졸버다. 저장되는 storyboard.cuts[].generated_image는
// 계속 asset:// 그대로 유지하고(스키마 pattern ^asset://), 화면 표시용
// URL만 이 라우트로 따로 받는다.
export async function GET(request: Request) {
  const uri = new URL(request.url).searchParams.get("uri");
  if (!uri) {
    return Response.json({ error: "uri 쿼리가 필요합니다" }, { status: 400 });
  }

  const url = await getAssetUrl(uri);
  if (!url) {
    return Response.json({ error: "자산을 찾을 수 없습니다" }, { status: 404 });
  }

  return Response.json({ url });
}
