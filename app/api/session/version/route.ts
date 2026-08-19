import { saveSessionVersion } from "@/lib/db/sessions";
import { assertStoryboardShape } from "../validate";

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

  try {
    const saved = await saveSessionVersion(sessionId, storyboard);
    if (!saved) return Response.json({ error: "없음" }, { status: 404 });
    return Response.json({ sessionId: saved.sessionId, version: saved.version });
  } catch (e) {
    console.error("[POST /api/session/version] 저장 실패:", e);
    return Response.json({ error: "버전 저장에 실패했습니다" }, { status: 500 });
  }
}
