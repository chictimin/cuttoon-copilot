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
// [임시] #219 CI 실패 전파 확인용 — 이 줄이 있는 커밋은 되돌린다
process.exit(1);
