// issue #209 F2 확인 API 응답 조립 오프라인 케이스 (verify #10).
// 실행: npx tsx lib/llm/font-probe.demo.ts
// 네트워크 없음 — resolveFontSource 실실행은 font-resolve.demo.ts 몫이다.
import {
  FONT_ERROR,
  fileNameFamily,
  toValidateResponse,
  validateFontUrl,
} from "./font-probe";
import type { FontResolveReason, FontResolveResult } from "@/lib/render/font";

let failed = 0;

function check(name: string, pass: boolean, detail?: string): void {
  if (pass) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` (받은 값: ${detail})` : ""}`);
  }
}

// --- fileNameFamily 3종 ---
check(
  "file percent-encoded 한글 → 나눔고딕",
  fileNameFamily("https://x/fonts/%EB%82%98%EB%88%94%EA%B3%A0%EB%94%95.ttf") === "나눔고딕",
  fileNameFamily("https://x/fonts/%EB%82%98%EB%88%94%EA%B3%A0%EB%94%95.ttf"),
);
check(
  "file query 포함 → 확장자·query 제외",
  fileNameFamily("https://x/fonts/NotoSans-Bold.ttf?subset=korean#frag") === "NotoSans-Bold",
  fileNameFamily("https://x/fonts/NotoSans-Bold.ttf?subset=korean#frag"),
);
check("file 빈 경로 → ProjectFont", fileNameFamily("https://x/") === "ProjectFont");

// --- toValidateResponse: 실패 10 reason + family_invalid ---
const resolveReasons: FontResolveReason[] = [
  "url_rejected",
  "fetch_failed",
  "timeout",
  "http_status",
  "too_large",
  "empty_body",
  "css_no_usable_src",
  "woff2",
  "parse_failed",
  "kind_mismatch",
];

for (const reason of resolveReasons) {
  const resp = toValidateResponse("https://x/a.ttf", { ok: false, reason });
  check(
    `toValidateResponse ${reason} (ok·error 동일·reason 일치·키 순서)`,
    resp.ok === false &&
      resp.error === FONT_ERROR &&
      resp.reason === reason &&
      JSON.stringify(resp) ===
        JSON.stringify({ ok: false, error: FONT_ERROR, reason }),
    JSON.stringify(resp),
  );
}

function fakeOk(over: Record<string, unknown>): FontResolveResult {
  return { ok: true, font: {} as never, kind: "file", cssFamily: null, fontFileUrl: "https://x/f", ...over } as FontResolveResult;
}

for (const [name, cssFamily] of [
  ["cssFamily null", null],
  ["cssFamily 빈 값", ""],
  ["cssFamily 공백만", "   "],
  ["cssFamily 61 코드포인트", "가".repeat(61)],
] as const) {
  const resp = toValidateResponse("https://x/a.css", fakeOk({ kind: "css", cssFamily }));
  check(
    `toValidateResponse ${name} → family_invalid`,
    !resp.ok && (resp as { reason: string }).reason === "family_invalid",
    JSON.stringify(resp),
  );
}

const cssOk = toValidateResponse("https://x/a.css", fakeOk({ kind: "css", cssFamily: "  Noto Sans KR  " }));
check(
  "toValidateResponse css 정상 (trim·url 그대로)",
  cssOk.ok === true && cssOk.family === "Noto Sans KR" && cssOk.url === "https://x/a.css" && cssOk.kind === "css",
  JSON.stringify(cssOk),
);

const fileOk = toValidateResponse(
  "https://x/fonts/NotoSans-Bold.ttf?subset=korean",
  fakeOk({ kind: "file" }),
);
check(
  "toValidateResponse file 정상 (파일명 family)",
  fileOk.ok === true &&
    fileOk.family === "NotoSans-Bold" &&
    fileOk.url === "https://x/fonts/NotoSans-Bold.ttf?subset=korean" &&
    fileOk.kind === "file",
  JSON.stringify(fileOk),
);

// --- validateFontUrl bad_request 3종 (fetch 호출 없음) ---
async function main(): Promise<void> {
  const noFetch = (() => {
    throw new Error("불러서는 안 됨");
  }) as unknown as typeof fetch;

  for (const [name, raw] of [
    ["비JSON(undefined)", undefined],
    ["url 누락({})", {}],
    ["2048자 초과", { url: `https://x/${"a".repeat(2040)}.ttf` }],
  ] as const) {
    const resp = await validateFontUrl(raw, { fetchImpl: noFetch });
    check(
      `validateFontUrl ${name} → bad_request`,
      !resp.ok && (resp as { reason: string }).reason === "bad_request",
      JSON.stringify(resp),
    );
  }

  if (failed > 0) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log("\n통과 (fileNameFamily 3종 + toValidateResponse 12 reason + validateFontUrl bad_request 3종)");
}

void main();
