import { exportCuts } from "@/lib/render/export";
import type { Cut } from "@/lib/render/types";
import { getSession } from "@/lib/db/sessions";

/**
 * 완성 컷을 ZIP으로 내려준다. GET /api/session/export?id=<sessionId>
 *
 * 이미지가 아직 없는 컷(generated_image=null)은 lib/render/export.ts가 건너뛰는데,
 * ZIP 본문에 JSON을 같이 실을 수 없으므로 그 사실을 응답 헤더로 알린다.
 *   X-Export-Included: 1,2
 *   X-Export-Skipped: 3,4
 * 화면단은 fetch로 헤더를 읽어 "N개 컷은 이미지가 없어 제외됐습니다"를 띄우면 된다.
 * <a download> 직행 링크로는 헤더를 못 읽으므로 fetch → blob 경로를 써야 한다.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 쿼리 필요" }, { status: 400 });

  let session;
  try {
    session = await getSession(id);
  } catch (e) {
    console.error("[GET /api/session/export] 세션 조회 실패:", e);
    return Response.json({ error: "세션 조회에 실패했습니다" }, { status: 500 });
  }
  if (!session) return Response.json({ error: "없음" }, { status: 404 });

  const { cuts, malformed } = toRenderCuts(session.storyboard.cuts);

  let result;
  try {
    result = await exportCuts(cuts);
  } catch (e) {
    console.error("[GET /api/session/export] ZIP 생성 실패:", e);
    return Response.json({ error: "Export에 실패했습니다" }, { status: 500 });
  }

  const skipped = [...result.skipped, ...malformed].sort((a, b) => a - b);

  // 이미지가 한 장도 없으면 빈 ZIP을 주지 않는다 — 빈 파일을 받고 원인을 짐작하게
  // 만드는 대신 실패를 실패로 드러낸다. 이미지 생성이 스텁인 동안은 이 경로가 흔하다.
  if (result.included.length === 0) {
    return Response.json({ error: "내보낼 이미지가 없습니다", skipped }, { status: 409 });
  }

  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(session.sessionId, session.storyboard.subject),
    "Content-Length": String(result.zip.byteLength),
  });
  // 빈 배열은 헤더 자체를 붙이지 않는다. 빈 문자열 헤더는 "없음"과 구분이 애매하다.
  if (result.included.length) headers.set("X-Export-Included", result.included.join(","));
  if (skipped.length) headers.set("X-Export-Skipped", skipped.join(","));

  return new Response(new Uint8Array(result.zip), { headers });
}

/**
 * session_versions.storyboard(jsonb)의 cuts를 lib/render/가 받는 Cut[]로 좁힌다.
 *
 * lib/db/sessions.ts의 StoryboardCut에는 caption·generated_image가 선언돼 있지
 * 않다(스키마 소유권이 A①이라 최상위 required만 타입으로 잡아둔 상태). 실물 jsonb에는
 * 있으므로 여기서 런타임으로 확인한다. 모양이 깨진 컷은 예외를 던지지 않고 malformed로
 * 빼둔다 — 컷 하나가 망가졌다고 Export 전체가 죽으면 안 되기 때문이다.
 */
function toRenderCuts(rawCuts: unknown): { cuts: Cut[]; malformed: number[] } {
  const cuts: Cut[] = [];
  const malformed: number[] = [];

  if (!Array.isArray(rawCuts)) return { cuts, malformed };

  rawCuts.forEach((raw, i) => {
    const cut = raw as Partial<Cut> | null;
    const index = typeof cut?.cut_index === "number" ? cut.cut_index : i + 1;

    if (!cut || typeof cut.cut_index !== "number" || typeof cut.caption?.text !== "string") {
      malformed.push(index);
      return;
    }

    cuts.push({
      cut_index: cut.cut_index,
      caption: cut.caption,
      generated_image: typeof cut.generated_image === "string" ? cut.generated_image : null,
    });
  });

  return { cuts, malformed };
}

/**
 * subject가 한글이라 ASCII 파일명을 fallback으로 두고 RFC 5987 filename*을 병기한다.
 * filename*을 못 읽는 클라이언트는 cuttoon-<id 앞 8자>.zip을 받는다.
 */
function contentDisposition(sessionId: string, subject: string): string {
  const fallback = `cuttoon-${sessionId.slice(0, 8)}.zip`;
  const encoded = encodeURIComponent(`${subject}.zip`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
