// checkUnmappedWordsPolicy(#15)의 매핑/근접치환/미매핑 세 경로를 확인하는 스크립트.
// 실행: npx tsx lib/llm/preset-guard.demo.ts
import { checkUnmappedWordsPolicy } from "./preset-guard";

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
