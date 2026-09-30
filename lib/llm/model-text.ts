// LLM 모델 출력 문자열 공통 정규화 (spec-llm-line.md 공통 경계).
//
// 순서: trim → 바깥 따옴표·마크다운 표식·줄바꿈 제거/공백화 → 화살표 통일 → 검증(호출부).
// JSON 구조·인덱스·허용 키 검사는 정규화한 결과로 수행한다.
// 키 매칭은 동의어를 추측하지 않고 JSON 원문 키와 비교한다.
//
// 로그에는 민감한 원문 대신 길이·오류 사유·항목 위치만 남긴다.

/** 서버 LLM 호출 제한 제안 초기값: 요청당 12초. 타임아웃은 재시도하지 않는다. */
export const LLM_REQUEST_TIMEOUT_MS = 12_000;

/** 길이 관찰 기준(초과해도 채택, 로그에만 기록). 거부 상한은 실측 이후 결정. */
export const OBSERVED_LIMITS = {
  subject: 200,
  caption: 60,
  flowOption: 60,
  presetTag: 40,
  suggestedSubject: 80,
} as const;

const ARROW_PATTERN = /->|=>|⇒|➔|―›/g;

/** 바깥을 감싼 한 겹의 따옴표·마크다운 표식을 벗긴다. */
function stripWrappers(text: string): string {
  let out = text;

  // ```펜스 (언어 태그 포함 가능)
  const fence = out.match(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/);
  if (fence) out = fence[1].trim();

  // 대칭 쌍 한 겹: "" '' ** `` 「」 『』 “” ‘’
  const pairs: Array<[string, string]> = [
    ["**", "**"],
    ["``", "``"],
    ["```", "```"],
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["「", "」"],
    ["『", "』"],
    ["`", "`"],
  ];
  for (const [open, close] of pairs) {
    if (out.length >= open.length + close.length && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, out.length - close.length).trim();
      break;
    }
  }
  return out;
}

/**
 * 모델 문자열 1개를 정규화한다. 빈 문자열·비문자열은 null.
 * 화살표 `->`·`=>`·`⇒` 등은 `→`로 통일한다.
 */
export function normalizeModelString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let out = value.trim();
  if (!out) return null;
  out = stripWrappers(out);
  out = out.replace(/\r?\n+/g, " ");
  out = out.replace(ARROW_PATTERN, "→");
  out = out.replace(/\s+/g, " ").trim();
  out = stripWrappers(out);
  if (!out) return null;
  return out;
}

/** 관찰 기준 초과를 로그에 남긴다. 원문은 남기지 않고 길이·위치만 남긴다. */
export function logObservedLength(
  scope: string,
  position: string,
  text: string,
  limit: number
): void {
  if (text.length > limit) {
    console.info(
      `[llm-length] ${scope} ${position} length=${text.length} over_limit=${limit}`
    );
  }
}
