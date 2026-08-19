import { writeFileSync } from "node:fs";
import { buildSessionCast } from "./session-cast";
import { checkUnmappedWordsPolicy, assertValidPreset, mergeStyleValues } from "./preset-guard";

const s = buildSessionCast({
  instructorCharacterId: "fairy_instructor",
  counterparts: [
    { character_id: "bear_grumpy", description: "무뚝뚝한 곰 회원" },
    { character_id: "rabbit_wink", description: "장난기 있는 토끼 회원" },
    { character_id: "duck_drinks", description: "음료를 든 오리 회원" },
    { character_id: "bear_clipboard", description: "기록하는 곰 회원" },
  ],
  shirtColors: ["파랑", "초록", "노랑", "빨강"],
  random: () => 0.3,
});
writeFileSync("/tmp/cast.json", JSON.stringify(s.cast, null, 2));
console.log(JSON.stringify(s, null, 2));

// checkUnmappedWordsPolicy 테스트
const testPreset = {
  preset_version: "1.1",
  project_name: "테스트 프로젝트",
  assets: {
    character_sheet: "asset://test",
    style_refs: ["asset://test"],
    reference_asset_ids: ["test"],
  },
  style: {
    keywords: ["귀여운", "파스텔", "카툰", "미매핑단어"],
    line_weight: "thin",
    palette: ["#FF0000"],
    saturation: "pastel",
    character_ratio: "2head",
    background_density: "low",
    bubble_style: "rounded",
  },
  rules: {
    forbidden: ["무서운 표정", "사실적(실사) 렌더링"],
    cta_format: "consult_request",
  },
  context: {
    industry: ["헬스케어", "시니어 피트니스 교육"],
    interests: ["info_education"],
    age_band: ["50s"],
    life_stage: ["retired"],
    main_subjects: ["갱년기", "무릎 관절 회복", "테스트"],
  },
};

assertValidPreset(testPreset);
const unmapped = checkUnmappedWordsPolicy(testPreset);
console.log("\n미매핑 단어:", unmapped);

// mergeStyleValues 테스트
console.log("\n--- mergeStyleValues 테스트 ---");

// 1. 추출값 없이 키워드만 있을 때
const result1 = mergeStyleValues(null, ["귀여운", "파스텔"]);
console.log("추출값 없음 + 키워드:", result1);

// 2. 추출값 있고 키워드도 있을 때 (충돌 - 사용자 키워드 우선)
const result2 = mergeStyleValues(
  { line_weight: "thick", saturation: "vivid" },
  ["thin", "pastel"]
);
console.log("추출값 + 키워드 (충돌):", result2);

// 3. 추출값만 있고 키워드 없을 때
const result3 = mergeStyleValues(
  { line_weight: "thin", saturation: "muted" },
  []
);
console.log("추출값만:", result3);
