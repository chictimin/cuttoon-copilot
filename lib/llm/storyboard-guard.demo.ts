// assertStoryboardRuntimeInvariants 세 체크(cut_index 유일성 · cta_override 유효성 ·
// cta 비트 개수/위치, #28)를 실제로 호출해 확인하는 스크립트. 테스트 러너를 추가하지
// 않는다 — lib/render/demo.ts와 같은 컨벤션.
//
// 실행: npx tsx lib/llm/storyboard-guard.demo.ts

import {
  assertStoryboardRuntimeInvariants,
  StoryboardValidationError,
  type StoryboardCut,
} from "./storyboard-guard";

function baseCuts(): StoryboardCut[] {
  return [
    { cut_index: 1, narrative_beat: "problem" },
    { cut_index: 2, narrative_beat: "before" },
    { cut_index: 3, narrative_beat: "solution" },
    { cut_index: 4, narrative_beat: "cta", cta_override: null },
  ];
}

const cases: [string, () => void, boolean][] = [
  ["정상 (cta가 4번)", () => assertStoryboardRuntimeInvariants(baseCuts()), true],
  [
    "cta 없음",
    () => {
      const cuts = baseCuts();
      cuts[3].narrative_beat = "after";
      assertStoryboardRuntimeInvariants(cuts);
    },
    false,
  ],
  [
    "cta가 2개",
    () => {
      const cuts = baseCuts();
      cuts[0].narrative_beat = "cta";
      assertStoryboardRuntimeInvariants(cuts);
    },
    false,
  ],
  [
    "cta가 4번이 아닌 위치(1번)",
    () => {
      const cuts = baseCuts();
      cuts[0].narrative_beat = "cta";
      cuts[3].narrative_beat = "after";
      assertStoryboardRuntimeInvariants(cuts);
    },
    false,
  ],
  [
    "cut_index 중복",
    () => {
      const cuts = baseCuts();
      cuts[1].cut_index = 1;
      assertStoryboardRuntimeInvariants(cuts);
    },
    false,
  ],
];

let failed = 0;

for (const [name, run, expectPass] of cases) {
  try {
    run();
    if (expectPass) {
      console.log(`ok   ${name}`);
    } else {
      failed++;
      console.error(`FAIL ${name} — 통과하면 안 되는데 통과함`);
    }
  } catch (err) {
    if (!expectPass && err instanceof StoryboardValidationError) {
      console.log(`ok   ${name} (예상대로 거부: ${err.message})`);
    } else {
      failed++;
      console.error(`FAIL ${name} — ${(err as Error).message}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log(`\n${cases.length}건 통과`);
