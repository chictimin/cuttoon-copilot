// 브레인스토밍 질문 문구 단일 출처 (issue #152 W1-b).
//
// brainstorm.ts·storyboard-assembly.ts·SessionFlow.tsx에 같은 문자열이 흩어져
// 있었다 — 값을 바꾸면 안 되므로(기존 세션·응답과 어긋나면 안 된다) 이 파일에
// 모아 세 곳이 모두 값으로 import한다.
//
// 값을 바꾸면 안 된다 — 기존 세션 storyboard의 cast[].description·brainstorm 응답과
// 문자열이 어긋나면 hasSupporting 판정이 깨진다.
export const NO_SUPPORTING_OPTION = "혼자 진행 (조연 없음)";

/** protagonist 턴 질문. */
export const PROTAGONIST_QUESTION = "주인공은 누구인가요?";

/** supporting 턴 질문. */
export const SUPPORTING_QUESTION = "함께 등장할 인물이 있나요?";

/** flow 턴 질문. 모델이 설명 문구를 내면 서버가 이 값으로 고정한다. */
export const FLOW_QUESTION = "어떤 흐름으로 풀어볼까요?";

/** 프로젝트 마스코트 참조. session-cast.ts·brainstorm.ts가 함께 쓴다. */
export interface MascotRef {
  label: string;
  description: string;
}

/**
 * 조연 턴의 마스코트 후보 문자열 (issue #150 C5, 캡틴 확정 표기).
 * `마스코트 — {description 앞 20자}` — 20자를 넘으면 "…"을 붙인다.
 * 코드포인트 단위로 자른다 — UTF-16 단위로 자르면 이모지 경계에서
 * lone surrogate가 생긴다. 서버가 결정적으로 넣는다(모델이 만들게 하지 않음).
 */
export function mascotOption(mascot: MascotRef): string {
  const chars = Array.from(mascot.description);
  const head = chars.slice(0, 20).join("");
  return `마스코트 — ${head}${chars.length > 20 ? "…" : ""}`;
}

/** 조연 답변이 마스코트 후보 선택인지 판별한다. session-cast.ts가 쓴다. */
export function isMascotOption(value: string, mascot: MascotRef): boolean {
  return value === mascotOption(mascot);
}

/** 빈 주인공 턴의 고정 답 (spec-a3 A3-6, 리드 지시 — 항상 이 값). */
export const PROTAGONIST_FALLBACK_OPTION = "이 소재의 주인공";

/**
 * 빈 선택지 턴의 "알아서 해줘" 답을 정한다 (issue #247, spec-a3 3-6).
 *
 * - 선택지가 있으면 `options[0]` — 현행 "알아서 해줘"와 같은 값(회귀 0).
 * - 빈 조연 턴: 마스코트가 있으면 `mascotOption(mascot)`, 없으면
 *   `NO_SUPPORTING_OPTION`(조연 없이).
 * - 빈 주인공 턴: 항상 고정 문구. context 값(age_band·life_stage)은 영문
 *   코드(60s_plus·retired)라 그대로 쓰면 한국어 라벨 형식이 달라지므로 쓰지
 *   않는다. 라벨 맵(DetailsStep AGE_BANDS/LIFE_STAGES)은 change-map 밖이라
 *   가져오지도 복제하지도 않는다(리드 지시).
 * - flow 턴은 normalizeFlowTurn이 항상 선택지를 채우므로 첫 분기로 끝난다.
 * - 같은 입력이면 같은 답(난수·LLM 없음). 주인공 답은 비어 있지 않다
 *   (buildSessionCast가 빈 주인공에서 예외를 던진다).
 */
export function autoAnswer(
  turn: { key: string; options: string[] },
  ctx: { mascot?: MascotRef; context?: { age_band?: string[]; life_stage?: string[] } }
): string {
  if (turn.options.length > 0) return turn.options[0];
  if (turn.key === "supporting") {
    return ctx.mascot ? mascotOption(ctx.mascot) : NO_SUPPORTING_OPTION;
  }
  if (turn.key === "protagonist") {
    return PROTAGONIST_FALLBACK_OPTION;
  }
  return "";
}
