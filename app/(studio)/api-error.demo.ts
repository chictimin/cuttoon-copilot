// #306 대응 demo — apiErrorText가 서버 문자열을 화면에 내보내지 않는지 확인.
// 외부 호출·DB 접근 없음.
//
// 실행: npx tsx "app/(studio)/api-error.demo.ts"

import { apiErrorText } from "./api-error";

const FALLBACK = "저장에 실패했어요. 다시 시도해주세요";
const warned: unknown[][] = [];
console.warn = (...args: unknown[]) => {
  warned.push(args);
};

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${String(actual)}`}`);
}

// 1. 내부 용어·영문 필드 경로가 든 400은 고정 문구로 바뀌고 원문은 콘솔에만 남는다
const leak = "스토리보드 계약 위반 3건";
check("400 계약 위반 → 고정 문구", apiErrorText(400, { error: leak, code: "invalid_storyboard" }, FALLBACK), FALLBACK);
check("원문은 콘솔에 남음", String(warned[0]?.[1]), leak);
check("콘솔 접두에 상태·code", String(warned[0]?.[0]), "[API 400 invalid_storyboard]");

check("subject_tags 경로 → 고정 문구", apiErrorText(400, { error: "subject_tags[0].category must be string" }, FALLBACK), FALLBACK);
check("404 '없음' → 고정 문구", apiErrorText(404, { error: "없음" }, FALLBACK), FALLBACK);

// 2. 500에 e.message가 그대로 실린 경우도 고정 문구
check("500 e.message → 고정 문구", apiErrorText(500, { error: "Cannot read properties of undefined" }, FALLBACK), FALLBACK);

// 3. code로 고른 문구만 예외
const byCode = { version_conflict: "다른 저장이 먼저 반영되었어요" };
check("code 지정 문구", apiErrorText(409, { error: "다른 저장이 먼저 반영되었습니다", code: "version_conflict" }, FALLBACK, byCode), byCode.version_conflict);
check("code가 목록에 없으면 고정 문구", apiErrorText(400, { error: "x", code: "invalid_storyboard" }, FALLBACK, byCode), FALLBACK);
check("'toString' 같은 code도 안전", apiErrorText(400, { error: "x", code: "toString" }, FALLBACK, byCode), FALLBACK);

// 4. 본문이 없거나 이상해도 던지지 않는다
check("본문 null", apiErrorText(500, null, FALLBACK), FALLBACK);
check("본문 문자열", apiErrorText(500, "oops", FALLBACK), FALLBACK);
check("error가 문자열 아님", apiErrorText(500, { error: 42 }, FALLBACK), FALLBACK);

if (failed > 0) {
  console.log(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log("\n전부 통과");
