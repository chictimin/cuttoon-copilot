// resolvePresetStyle(#151·#125)의 경로를 확인하는 스크립트.
// 실행: npx tsx lib/llm/style-resolve.demo.ts
import { resolvePresetStyle } from "./style-resolve";

const nullEmpty = resolvePresetStyle({ extracted: null, userKeywords: [], forbidden: [] });
console.log("[extracted null + 빈 입력]");
console.log(JSON.stringify(nullEmpty, null, 2));

const override = resolvePresetStyle({
  extracted: {
    line_weight: "medium",
    saturation: "vivid",
    character_ratio: "3head",
    background_density: "high",
    bubble_style: "cloud",
    palette: ["#000000"],
  },
  userKeywords: ["thin", "pastel"],
  forbidden: [],
});
console.log("[enum 일치 키워드가 추출값을 덮어씀]");
console.log(JSON.stringify(override, null, 2));

const vocab = resolvePresetStyle({
  extracted: null,
  userKeywords: ["귀여운", "몽환적인우주감성"],
  forbidden: ["사실적(실사) 렌더링", "실사"],
});
console.log("[어휘 등재·미등재 단어]");
console.log(JSON.stringify(vocab, null, 2));

function find(result: typeof vocab, field: string, original: string) {
  return result.findings.find((f) => f.field === field && f.original === original);
}

const checks: [string, boolean][] = [
  ["extracted null + 빈 입력 → keywordHints·forbiddenHints 빈 배열", nullEmpty.keywordHints.length === 0 && nullEmpty.forbiddenHints.length === 0],
  ["enum 일치 키워드 thin·pastel이 추출값을 덮어씀", override.style.line_weight === "thin" && override.style.saturation === "pastel"],
  ["어휘 등재 단어 귀여운 → 영문 힌트", vocab.keywordHints.includes("cute, endearing")],
  ["어휘 미등재 단어 몽환적인우주감성 → 원본 유지 + unmapped 1건", vocab.keywordHints.includes("몽환적인우주감성") && find(vocab, "style.keywords", "몽환적인우주감성")?.status === "unmapped"],
];

// spec-b2 경계 케이스: enum으로 적용된 키워드는 findings에 enum_applied로 남는다.
const enumApplied = resolvePresetStyle({ extracted: null, userKeywords: ["thin", "pastel"], forbidden: [] });
const secondEnum = resolvePresetStyle({ extracted: null, userKeywords: ["thin", "thick"], forbidden: [] });
const spacedEnum = resolvePresetStyle({ extracted: null, userKeywords: [" thin"], forbidden: [] });
const casedEnum = resolvePresetStyle({ extracted: null, userKeywords: ["Thin"], forbidden: [] });
const forbiddenEnum = resolvePresetStyle({ extracted: null, userKeywords: ["thin"], forbidden: ["thin"] });

checks.push(
  ["enum 적용 단어 thin·pastel → findings enum_applied 2건(개수 유지)", enumApplied.findings.length === 2 && find(enumApplied, "style.keywords", "thin")?.status === "enum_applied" && find(enumApplied, "style.keywords", "pastel")?.status === "enum_applied"],
  ["같은 필드 두 번째 enum thick → unmapped 유지", find(secondEnum, "style.keywords", "thin")?.status === "enum_applied" && find(secondEnum, "style.keywords", "thick")?.status === "unmapped"],
  ["앞 공백·대소문자 enum → unmapped 유지", spacedEnum.findings[0]?.status === "unmapped" && casedEnum.findings[0]?.status === "unmapped"],
  ["forbidden thin → rules.forbidden unmapped 유지", find(forbiddenEnum, "rules.forbidden", "thin")?.status === "unmapped"],
);

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
