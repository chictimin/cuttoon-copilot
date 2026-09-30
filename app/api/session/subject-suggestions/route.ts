import { getPreset } from "@/lib/db/presets";
import { assertValidPreset } from "@/lib/llm/preset-guard";
import { suggestSubjects } from "@/lib/llm/subject-suggestions";

export const runtime = "nodejs";

/**
 * F3 세션 소재 "알아서 해줘".
 * body: { presetId }
 * - 서버에서 프리셋을 재조회·검증해 context.industry, context.interests,
 *   context.main_subjects를 프롬프트에 넣는다.
 * - 세 문맥이 모두 비면 LLM을 호출하지 않고 거부한다.
 * - 응답: {subjects:[최대 3개]}. 화면은 후보를 3개까지 선택지로 표시하며 자동 채택하지 않는다.
 * - 결정된 소재만 기존 /api/brainstorm·저장 경로로 이어진다.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  const { presetId } = (body ?? {}) as Record<string, unknown>;
  if (typeof presetId !== "string" || presetId.length === 0) {
    return Response.json({ error: "presetId가 필요합니다" }, { status: 400 });
  }

  let saved;
  try {
    saved = await getPreset(presetId);
  } catch (e) {
    console.error("[POST /api/session/subject-suggestions] 프리셋 조회 실패:", e);
    return Response.json({ error: "프리셋 조회에 실패했습니다" }, { status: 500 });
  }
  if (!saved) return Response.json({ error: "없음" }, { status: 404 });

  try {
    assertValidPreset(saved.preset);
  } catch (e) {
    console.error("[POST /api/session/subject-suggestions] 저장된 프리셋 검증 실패:", e);
    return Response.json({ error: "프리셋 확인에 실패했습니다" }, { status: 500 });
  }

  const industry = saved.preset.context.industry.filter((s) => s.trim().length > 0);
  const interests = saved.preset.context.interests.filter((s) => s.trim().length > 0);
  const main_subjects = saved.preset.context.main_subjects.filter(
    (s) => s.trim().length > 0
  );

  // 세 문맥이 모두 비면 LLM을 호출하지 않고 거부한다. 화면은 버튼을 비활성화하고
  // 같은 문구를 표시한다.
  if (industry.length === 0 && interests.length === 0 && main_subjects.length === 0) {
    return Response.json(
      { error: "프로젝트에 분야를 넣으면 추천돼요" },
      { status: 400 }
    );
  }

  try {
    const result = await suggestSubjects({ industry, interests, main_subjects });
    return Response.json(result);
  } catch (error) {
    console.error("소재 추천 에러:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "소재 추천에 실패했습니다. 다시 시도해주세요.",
      },
      { status: 500 }
    );
  }
}
