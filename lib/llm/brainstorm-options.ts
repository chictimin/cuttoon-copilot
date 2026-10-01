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
