import { createSession, getSession } from "@/lib/db/sessions";
import { assertStoryboardShape } from "./validate";

/** 세션 생성 + 첫 버전 저장. body: { projectId, presetId, storyboard } */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  const { projectId, presetId, storyboard } = (body ?? {}) as Record<string, unknown>;

  if (typeof projectId !== "string" || typeof presetId !== "string") {
    return Response.json({ error: "projectId · presetId가 필요합니다" }, { status: 400 });
  }

  try {
    assertStoryboardShape(storyboard);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "스토리보드 검증 실패" },
      { status: 400 }
    );
  }

  // DB 실패는 요청 내용의 문제가 아니므로 400과 구분한다. 원문 메시지는 내부
  // 정보(테이블명·제약조건)를 담으므로 응답에 넣지 않고 로그로만 남긴다.
  try {
    const saved = await createSession({ projectId, presetId, storyboard });
    return Response.json({ sessionId: saved.sessionId, version: saved.version });
  } catch (e) {
    console.error("[POST /api/session] 저장 실패:", e);
    return Response.json({ error: "세션 저장에 실패했습니다" }, { status: 500 });
  }
}

/** 최신 버전의 스토리보드와 함께 세션을 읽는다. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 쿼리 필요" }, { status: 400 });

  try {
    const found = await getSession(id);
    if (!found) return Response.json({ error: "없음" }, { status: 404 });
    return Response.json(found);
  } catch (e) {
    console.error("[GET /api/session] 조회 실패:", e);
    return Response.json({ error: "세션 조회에 실패했습니다" }, { status: 500 });
  }
}
