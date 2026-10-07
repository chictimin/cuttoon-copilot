import {
  saveSessionVersion,
  SessionVersionConflictError,
  StoryboardProtectionError,
} from "@/lib/db/sessions";
import { assertStoryboardShape, buildStoryboardJudge, loadDemoCacheValues } from "../validate";

/** 새 버전을 쌓는다. body: { sessionId, storyboard } */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  const { sessionId, storyboard } = (body ?? {}) as Record<string, unknown>;

  if (typeof sessionId !== "string") {
    return Response.json({ error: "sessionId가 필요합니다" }, { status: 400 });
  }

  try {
    assertStoryboardShape(storyboard);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "스토리보드 검증 실패" },
      { status: 400 }
    );
  }

  // 보호 비교는 같은 조회 결과로 판정해야 하므로 saveSessionVersion 안의
  // judge가 맡는다. 여기서 baseline 없이 계약 전량을 보면 기존 위반까지 막힌다.
  try {
    const saved = await saveSessionVersion(
      sessionId,
      storyboard,
      buildStoryboardJudge(await loadDemoCacheValues())
    );
    if (!saved) return Response.json({ error: "없음" }, { status: 404 });
    return Response.json({ sessionId: saved.sessionId, version: saved.version });
  } catch (e) {
    if (e instanceof StoryboardProtectionError) {
      return Response.json(
        {
          error: e.message,
          code: "invalid_storyboard",
          problems: e.problems,
        },
        { status: 400 }
      );
    }
    if (e instanceof SessionVersionConflictError) {
      return Response.json(
        { error: "다른 저장이 먼저 반영되었습니다", code: "version_conflict" },
        { status: 409 }
      );
    }
    console.error("[POST /api/session/version] 저장 실패:", e);
    return Response.json({ error: "버전 저장에 실패했습니다" }, { status: 500 });
  }
}
