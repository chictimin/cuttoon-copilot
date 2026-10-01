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
 * 서버가 결정적으로 넣는다(모델이 만들게 하지 않음).
 */
export function mascotOption(mascot: MascotRef): string {
  const head = mascot.description.slice(0, 20);
  return `마스코트 — ${head}${mascot.description.length > 20 ? "…" : ""}`;
}

/** 조연 답변이 마스코트 후보 선택인지 판별한다. session-cast.ts가 쓴다. */
export function isMascotOption(value: string, mascot: MascotRef): boolean {
  return value === mascotOption(mascot);
}
