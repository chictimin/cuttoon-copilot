// "혼자 진행 (조연 없음)" 옵션 문자열을 한 곳에 둔다.
//
// brainstorm.ts에 두지 않은 이유: brainstorm.ts는 OPENAI_API_KEY를 쓰는 서버
// 전용 모듈이라 클라이언트 컴포넌트(app/(studio)/session/[id]/SessionFlow.tsx)가
// 값으로 import할 수 없다(타입만 가져오는 것이 기존 관례). 이 문자열 자체는
// 서버 비밀과 무관한 순수 상수라 별도 파일로 빼서 SessionFlow.tsx·
// storyboard-assembly.ts·brainstorm.ts 세 곳이 모두 값으로 import할 수 있게 한다.
//
// 값을 바꾸면 안 된다 — 기존 세션 storyboard의 cast[].description·brainstorm 응답과
// 문자열이 어긋나면 hasSupporting 판정이 깨진다.
export const NO_SUPPORTING_OPTION = "혼자 진행 (조연 없음)";
