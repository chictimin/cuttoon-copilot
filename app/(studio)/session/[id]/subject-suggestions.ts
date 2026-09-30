import type { Preset } from "@/lib/llm/preset-guard";

// 2차 4번 — 세션 소재 단계의 "알아서 해줘": preset.context로 소재 후보 3개를 받는다.
// 계약은 #181 (chictimin 2026-09-30 확정, 서버는 PR #189):
//   POST /api/session/subject-suggestions
//   요청 { presetId } — 서버가 프리셋을 재조회한다(브라우저가 문맥을 보내지 않는다)
//   응답 { subjects: string[] } — 정규화 후 최대 3개
//   오류 { error: string } — 문맥 3종이 모두 비면 400, 프리셋 없음 404, 그 밖 500

export const MAX_SUBJECT_SUGGESTIONS = 3;

export const EMPTY_CONTEXT_HINT = "프로젝트에 분야를 넣으면 추천돼요";

// 세 문맥이 모두 비면 제안하지 않는다(#181 결정 2). 서버도 같은 경우 LLM을
// 호출하지 않고 거부하므로, 화면이 먼저 버튼을 막아 불필요한 요청을 없앤다.
export function hasSuggestionContext(preset: Preset): boolean {
  const { industry, interests, main_subjects } = preset.context;
  return industry.length + interests.length + main_subjects.length > 0;
}

// 응답 정규화: 공백 제거 → 빈 값·중복 제거 → 최대 3개. 유효 후보가 없으면 실패로
// 던진다(#60 ② 실패 가시화 — 조용히 빈 목록을 성공처럼 보여주지 않는다).
function normalizeSubjects(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("소재 후보 응답 형식이 올바르지 않습니다");
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text) seen.add(text);
  }
  const subjects = [...seen].slice(0, MAX_SUBJECT_SUGGESTIONS);
  if (subjects.length === 0) throw new Error("소재 후보가 비어 있습니다");
  return subjects;
}

// "다시 뽑기"도 같은 요청을 다시 부른다(횟수 제한 없음, #181).
export async function fetchSubjectSuggestions(presetId: string): Promise<string[]> {
  const res = await fetch("/api/session/subject-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presetId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "소재 후보를 만들지 못했습니다");
  }
  const { subjects } = (await res.json()) as { subjects: unknown };
  return normalizeSubjects(subjects);
}
