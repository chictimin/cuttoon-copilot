import type { Preset } from "@/lib/llm/preset-guard";

// 2차 4번 — 세션 소재 단계의 "알아서 해줘": preset.context로 소재 후보 3개를 받는다.
// 계약은 #181 (chictimin 2026-09-30 확정):
//   POST /api/session/subject-suggestions
//   요청 { presetId } — 서버가 프리셋을 재조회한다(브라우저가 문맥을 보내지 않는다)
//   응답 { subjects: string[] } — 정규화 후 최대 3개
// 서버(lib/llm/ + app/api/session/)는 chictimin 담당이라 아직 없다. 그 전까지
// 같은 모양을 돌려주는 mock으로 동작한다(스텁 3규칙, #60).

// stub: 서버 API가 머지되면 false로 바꾸고 아래 mockSubjectSuggestions와 그 호출을 지운다.
const USE_MOCK = true;

export const MAX_SUBJECT_SUGGESTIONS = 3;

export const EMPTY_CONTEXT_HINT = "프로젝트에 분야를 넣으면 추천돼요";

export interface SubjectSuggestions {
  subjects: string[];
  /** 스텁 표식(#60 ①): true면 서버가 만든 후보가 아니라 mock이다. 화면이 숨기지 않는다. */
  stub?: boolean;
}

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

// attempt는 "다시 뽑기" 횟수(0부터). mock이 매번 다른 후보를 돌려주기 위한 값이고,
// 실제 서버 계약에는 없어서 요청 본문에 싣지 않는다.
export async function fetchSubjectSuggestions(
  presetId: string,
  preset: Preset,
  attempt: number
): Promise<SubjectSuggestions> {
  if (USE_MOCK) {
    return { subjects: normalizeSubjects(mockSubjectSuggestions(preset, attempt)), stub: true };
  }

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
  return { subjects: normalizeSubjects(subjects) };
}

// ── mock (stub) ─────────────────────────────────────────────────────────────
// preset.context의 단어로 후보를 조립해 돌려준다. 실제 LLM 품질이 아니라 화면 흐름
// (선택·다시 뽑기·실패·빈 문맥)을 검증하기 위한 임시 값이다.

const INTEREST_LABEL: Record<string, string> = {
  brand_awareness: "브랜드 알리기",
  trust_building: "신뢰 쌓기",
  product_showcase: "제품 소개",
  sales_conversion: "구매 유도",
  event_promotion: "이벤트 홍보",
  info_education: "정보 전달",
  lead_generation: "문의 받기",
  recruiting: "모집",
};

const MOCK_PATTERNS = [
  (t: string) => `${t}에 대해 자주 받는 질문`,
  (t: string) => `${t} 처음 시작할 때 하는 실수`,
  (t: string) => `${t}, 이럴 땐 이렇게`,
  (t: string) => `${t} 오해와 진실`,
  (t: string) => `${t} 고르는 법`,
  (t: string) => `${t} 하루 만에 달라지는 습관`,
];

function mockSubjectSuggestions(preset: Preset, attempt: number): string[] {
  const { industry, interests, main_subjects } = preset.context;
  const topics = main_subjects.length > 0 ? main_subjects : industry;
  if (topics.length === 0) {
    // interests만 있는 경우 — 목적 라벨로 일반 후보를 만든다.
    const goals = interests.map((i) => INTEREST_LABEL[i] ?? i);
    return goals.map((g) => `${g}를 위한 이야기`);
  }
  const out: string[] = [];
  for (let n = 0; n < MAX_SUBJECT_SUGGESTIONS; n++) {
    const k = attempt * MAX_SUBJECT_SUGGESTIONS + n;
    out.push(MOCK_PATTERNS[k % MOCK_PATTERNS.length](topics[k % topics.length]));
  }
  return out;
}
