import { revertSession } from "@/lib/db/sessions";
import { buildStoryboardJudge, loadDemoCacheValues } from "../validate";

/**
 * 되돌리기 1단계. body: { sessionId }
 *
 * 되돌릴 이전 버전이 없으면(v1뿐) 409를 준다 — 요청 자체는 올바르고 세션도
 * 존재하므로 400·404와 구분한다. 화면은 이 응답으로 버튼을 비활성화하면 된다.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  const { sessionId } = (body ?? {}) as Record<string, unknown>;
  if (typeof sessionId !== "string") {
    return Response.json({ error: "sessionId가 필요합니다" }, { status: 400 });
  }

  try {
    const result = await revertSession(
      sessionId,
      buildStoryboardJudge(await loadDemoCacheValues())
    );
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return Response.json({ error: "없음" }, { status: 404 });
      }
      if (result.reason === "invalid_subject_tags") {
        return Response.json(
          { error: "되돌릴 버전의 소재 태그가 형식에 맞지 않습니다" },
          { status: 409 }
        );
      }
      if (result.reason === "invalid_storyboard") {
        return Response.json(
          {
            error: "되돌릴 버전의 스토리보드가 계약에 맞지 않습니다",
            code: "invalid_storyboard",
          },
          { status: 409 }
        );
      }
      // 남은 reason은 no_previous_version → 409 (기존 분기 유지).
      return Response.json({ error: "되돌릴 이전 버전이 없습니다" }, { status: 409 });
    }
    return Response.json({
      sessionId: result.session.sessionId,
      version: result.session.version,
      storyboard: result.session.storyboard,
    });
  } catch (e) {
    console.error("[POST /api/session/revert] 되돌리기 실패:", e);
    return Response.json({ error: "되돌리기에 실패했습니다" }, { status: 500 });
  }
}
