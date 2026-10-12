// 서버 오류 응답을 화면에 보일 문구로 바꾸는 클라이언트 유틸 (#306).
//
// 서버 응답의 `error` 문자열은 라우트에 따라 `e.message`가 그대로 실려
// `subject_tags[0].category…` 같은 영문 필드 경로나 "계약 위반 N건" 같은 내부 용어가
// 섞일 수 있다. 화면에는 호출부가 정한 고정 문구만 보이게 하고, 서버 문자열은
// 콘솔에만 남긴다(#260의 subject_tags 400 처리와 같은 방식).
//
// 서버가 준 사정이 사용자에게도 의미 있는 경우(예: 버전 충돌)는 응답의 `code`로 골라
// 호출부가 문구를 직접 지정한다 — 서버 문장을 그대로 쓰지 않는다.

export function apiErrorText(
  status: number,
  body: unknown,
  fallback: string,
  byCode?: Record<string, string>
): string {
  const parsed =
    body !== null && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : null;
  const code = typeof parsed?.code === "string" ? parsed.code : undefined;
  if (typeof parsed?.error === "string") {
    console.warn(`[API ${status}${code ? ` ${code}` : ""}]`, parsed.error);
  }
  if (code && byCode && Object.hasOwn(byCode, code)) return byCode[code];
  return fallback;
}
