// checkUnmappedWordsPolicy(#15)의 매핑/근접치환/미매핑 세 경로를 확인하는 스크립트.
// 실행: npx tsx lib/llm/preset-guard.demo.ts
import { assertNoPresetExtraKeys, assertValidPreset, checkUnmappedWordsPolicy } from "./preset-guard";

const result = checkUnmappedWordsPolicy({
  style: { keywords: ["귀여운", "몽환적인우주감성"] },
  rules: { forbidden: ["사실적(실사) 렌더링", "무서운"] },
});

console.log(JSON.stringify(result, null, 2));

function find(field: string, original: string) {
  return result.findings.find((f) => f.field === field && f.original === original);
}

const checks: [string, boolean][] = [
  ["귀여운(keywords) → mapped(정확히 등재됨)", find("style.keywords", "귀여운")?.status === "mapped"],
  ["몽환적인우주감성(keywords) → unmapped(근접 매칭도 안 됨, 원본 유지)", find("style.keywords", "몽환적인우주감성")?.status === "unmapped"],
  ["사실적(실사) 렌더링(forbidden) → mapped", find("rules.forbidden", "사실적(실사) 렌더링")?.status === "mapped"],
  ["무서운(forbidden) → substituted(\"무서운 표정\"에 포함 관계로 매칭)", find("rules.forbidden", "무서운")?.status === "substituted" && find("rules.forbidden", "무서운")?.matchedTerm === "무서운 표정"],
];

let failed = 0;
for (const [name, pass] of checks) {
  if (pass) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log(`\n${checks.length}건 통과`);

// issue #209: assets.font 경계 케이스. 스키마와 가드가 같은 판정이어야 한다.
const basePreset = {
  preset_version: "1.1",
  project_name: "p",
  assets: { character_sheet: "asset://a", style_refs: [], reference_asset_ids: [] },
  style: {
    keywords: [],
    line_weight: "medium",
    palette: ["#FFFFFF"],
    saturation: "pastel",
    character_ratio: "2head",
    background_density: "low",
    bubble_style: "rounded",
  },
  rules: { forbidden: [], cta_format: "consult_request" },
  context: { industry: [], interests: [], age_band: [], life_stage: [], main_subjects: [] },
} as const;

function withFont(font: unknown) {
  return { ...basePreset, assets: { ...basePreset.assets, font } };
}

const EM = String.fromCodePoint(0x1f600);
const LONE = String.fromCharCode(0xd800);
const fontCases: [string, unknown, boolean][] = [
  ["font 없음 → 통과(기존 프리셋 회귀 0)", { ...basePreset }, true],
  ["정상 font → 통과", withFont({ family: "N", url: "https://x/y.ttf", kind: "file" }), true],
  ["kind 누락 → 거부", withFont({ family: "N", url: "https://x/y.ttf" }), false],
  ["kind 이상값 → 거부", withFont({ family: "N", url: "https://x/y.ttf", kind: "otf" }), false],
  ["추가 키 → 거부", withFont({ family: "N", url: "https://x/y.ttf", kind: "file", x: 1 }), false],
  ["http url → 거부", withFont({ family: "N", url: "http://x/y.ttf", kind: "file" }), false],
  ["family 0자 → 거부", withFont({ family: "", url: "https://x/y.ttf", kind: "file" }), false],
  ["family 61자 → 거부", withFont({ family: "a".repeat(61), url: "https://x/y.ttf", kind: "file" }), false],
  ["family 한글 59자 → 통과", withFont({ family: "가".repeat(59), url: "https://x/y.ttf", kind: "file" }), true],
  ["family 한글 60자 → 통과", withFont({ family: "가".repeat(60), url: "https://x/y.ttf", kind: "file" }), true],
  ["family 한글 61자 → 거부", withFont({ family: "가".repeat(61), url: "https://x/y.ttf", kind: "file" }), false],
  ["family 이모지 30개(코드포인트 30) → 통과", withFont({ family: EM.repeat(30), url: "https://x/y.ttf", kind: "file" }), true],
  ["family 이모지 60개(코드포인트 60, UTF-16 120) → 통과", withFont({ family: EM.repeat(60), url: "https://x/y.ttf", kind: "file" }), true],
  ["family 이모지 61개 → 거부", withFont({ family: EM.repeat(61), url: "https://x/y.ttf", kind: "file" }), false],
  ["family 짝 없는 서로게이트 포함 60 코드포인트 → 통과", withFont({ family: "가".repeat(59) + LONE, url: "https://x/y.ttf", kind: "file" }), true],
];

let fontFailed = 0;
for (const [name, preset, expectPass] of fontCases) {
  let pass = false;
  try {
    assertValidPreset(structuredClone(preset));
    pass = true;
  } catch {
    pass = false;
  }
  if (pass === expectPass) {
    console.log(`ok   ${name}`);
  } else {
    fontFailed++;
    console.error(`FAIL ${name} (기대 ${expectPass ? "통과" : "거부"})`);
  }
}

if (fontFailed > 0) {
  console.error(`\nfont ${fontFailed}건 실패`);
  process.exit(1);
}
console.log(`\nfont ${fontCases.length}건 통과`);

// spec-263-r1 R1-b (8-2): POST 저장 전용 추가 키 검사. 허용 키만 → 무throw,
// 4곳 추가 키 → throw(메시지는 `<obj>에 허용되지 않은 필드: <키>` 이어 붙임).
const extraCases: [string, unknown, string | null][] = [
  ["허용 키만 → 통과", { ...basePreset }, null],
  ["assets 추가 키 → 거부", { ...basePreset, assets: { ...basePreset.assets, extra: 1 } }, "assets에 허용되지 않은 필드: extra"],
  ["style 추가 키 → 거부", { ...basePreset, style: { ...basePreset.style, extra: 1 } }, "style에 허용되지 않은 필드: extra"],
  ["rules 추가 키 → 거부", { ...basePreset, rules: { ...basePreset.rules, extra: 1 } }, "rules에 허용되지 않은 필드: extra"],
  ["context 추가 키 → 거부", { ...basePreset, context: { ...basePreset.context, extra: 1 } }, "context에 허용되지 않은 필드: extra"],
];

let extraFailed = 0;
for (const [name, preset, expectMessage] of extraCases) {
  let message: string | null = null;
  try {
    assertNoPresetExtraKeys(structuredClone(preset));
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  const pass =
    expectMessage === null ? message === null : message !== null && message.includes(expectMessage);
  if (pass) {
    console.log(`ok   ${name}`);
  } else {
    extraFailed++;
    console.error(`FAIL ${name} (받은 메시지: ${message})`);
  }
}

if (extraFailed > 0) {
  console.error(`\nextra ${extraFailed}건 실패`);
  process.exit(1);
}
console.log(`\nextra ${extraCases.length}건 통과`);
