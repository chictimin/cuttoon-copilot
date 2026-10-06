// imageSetting()·imageQuality() / activeMascot() / buildCharacterPrompt() 순수 함수 경계를 확인하는 스크립트.
// lib/llm/preset-guard.demo.ts와 같은 컨벤션(검사 나열, 실패 시 process.exit(1), 통과 시 요약 출력).
// 네트워크·유료 호출·이미지 생성을 하지 않는다 — 순수 함수만 부른다.
//
// 실행: npx tsx --conditions=react-server lib/openai/prompt.demo.ts

// generate.ts·extract.ts는 import 시점에 OpenAI·Supabase 클라이언트를 만든다.
// 먼저 가짜 값을 깔고 동적 import로 불러온다 (.env를 읽지 않는다).
process.env.OPENAI_API_KEY = "sk-demo-fake";
process.env.SUPABASE_URL = "https://demo.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "demo";

import type { PresetInput } from "./extract";

async function main(): Promise<void> {
  const { imageSetting, imageQuality } = await import("./image-setting");
  const { activeMascot, ratioClause, buildCutPrompt } = await import("./generate");
  const { buildCharacterPrompt } = await import("./extract");

  const checks: [string, boolean][] = [];

  // --- 1. imageSetting()·imageQuality() ---
  const originalImageProvider = process.env.IMAGE_PROVIDER;

  function withImageProvider(value: string | undefined, fn: () => void): void {
    try {
      if (value === undefined) {
        delete process.env.IMAGE_PROVIDER;
      } else {
        process.env.IMAGE_PROVIDER = value;
      }
      fn();
    } finally {
      if (originalImageProvider === undefined) {
        delete process.env.IMAGE_PROVIDER;
      } else {
        process.env.IMAGE_PROVIDER = originalImageProvider;
      }
    }
  }

  withImageProvider(undefined, () => {
    checks.push(["IMAGE_PROVIDER 미설정 → 'openai'", imageSetting() === "openai"]);
  });
  withImageProvider(undefined, () => {
    checks.push(["IMAGE_PROVIDER 미설정 → quality undefined", imageQuality(imageSetting()) === undefined]);
  });
  withImageProvider("openai", () => {
    checks.push(["'openai' → 'openai'", imageSetting() === "openai"]);
  });
  withImageProvider("openai", () => {
    checks.push(["'openai' → quality undefined", imageQuality(imageSetting()) === undefined]);
  });
  withImageProvider("openai-low", () => {
    checks.push(["'openai-low' → 'openai-low'", imageSetting() === "openai-low"]);
  });
  withImageProvider("openai-low", () => {
    checks.push(["'openai-low' → quality 'low'", imageQuality(imageSetting()) === "low"]);
  });
  withImageProvider(" OpenAI-Low ", () => {
    checks.push(["' OpenAI-Low '(공백·대소문자) → 'openai-low'", imageSetting() === "openai-low"]);
  });
  withImageProvider("openai_low", () => {
    let threw = false;
    try {
      imageSetting();
    } catch {
      threw = true;
    }
    checks.push(["'openai_low'(오타) → 예외", threw]);
  });

  // --- 2. activeMascot() ---
  {
    const got = activeMascot({ mascot: { label: "mascot", description: "d" } });
    checks.push([
      "{label:'mascot',description:'d'} → 같은 값",
      got?.label === "mascot" && got?.description === "d",
    ]);
  }
  {
    const got = activeMascot({ mascot: { label: "  mascot  ", description: "  hello  " } });
    checks.push(["앞뒤 공백 trim", got?.label === "mascot" && got?.description === "hello"]);
  }
  {
    checks.push([
      "description 빈 문자열 → undefined",
      activeMascot({ mascot: { label: "mascot", description: "" } }) === undefined,
    ]);
  }
  {
    checks.push([
      "description 공백만 → undefined",
      activeMascot({ mascot: { label: "mascot", description: "   " } }) === undefined,
    ]);
  }
  {
    checks.push([
      "label 빈 값 → undefined",
      activeMascot({ mascot: { label: "", description: "d" } }) === undefined,
    ]);
  }
  {
    checks.push([
      "label 공백만 → undefined",
      activeMascot({ mascot: { label: "   ", description: "d" } }) === undefined,
    ]);
  }
  {
    checks.push(["mascot 없음 → undefined", activeMascot({}) === undefined]);
  }
  {
    checks.push(["preset undefined → undefined", activeMascot(undefined) === undefined]);
  }

  // --- 3. buildCharacterPrompt() ---
  function basePreset(): PresetInput {
    return {
      style: {
        line_weight: "medium",
        saturation: "vivid",
        character_ratio: "2.5head",
        background_density: "low",
        bubble_style: "rounded",
        palette: ["#2b2b2b", "#f5f0e8", "#e8734a", "#4a90a4"],
        keywords: [],
      },
      context: {
        industry: [],
        age_band: [],
        life_stage: [],
        main_subjects: [],
      },
    };
  }

  {
    const prompt = buildCharacterPrompt(basePreset());
    checks.push(["mascot 없음 → 'Character context:' 포함", prompt.includes("Character context:")]);
    checks.push(["mascot 없음 → 'recurring mascot' 미포함", !prompt.includes("recurring mascot")]);
  }
  {
    const preset: PresetInput = {
      ...basePreset(),
      mascot: { label: "mascot", description: "a brave fox" },
    };
    const prompt = buildCharacterPrompt(preset);
    checks.push(["mascot 있음 → description 포함", prompt.includes("a brave fox")]);
    checks.push(["mascot 있음 → 'recurring mascot' 포함", prompt.includes("recurring mascot")]);
    checks.push(["mascot 있음 → 'Character context:' 미포함", !prompt.includes("Character context:")]);
  }
  {
    const preset: PresetInput = {
      ...basePreset(),
      mascot: { label: "mascot", description: "   " },
    };
    const prompt = buildCharacterPrompt(preset);
    checks.push(["description 공백뿐 → 'Character context:' 포함", prompt.includes("Character context:")]);
    checks.push(["description 공백뿐 → 'recurring mascot' 미포함", !prompt.includes("recurring mascot")]);
  }
  {
    const preset = basePreset();
    preset.style.character_ratio = "3head";
    const prompt = buildCharacterPrompt(preset);
    checks.push(["ratioClause('3head') 문자열이 그대로 포함", prompt.includes(ratioClause("3head"))]);
  }
  {
    const preset = basePreset();
    preset.style.character_ratio =
      undefined as unknown as PresetInput["style"]["character_ratio"];
    const prompt = buildCharacterPrompt(preset);
    checks.push([
      "ratioClause(undefined) 문자열이 그대로 포함(값 없음)",
      prompt.includes(ratioClause(undefined)),
    ]);
  }

  // --- 4. #151 영문 힌트 폴백 (keyword_hints ?? keywords, forbidden_hints ?? forbidden) ---
  // 힌트가 있으면 힌트, 없으면 원본. 컷(buildCutPrompt)과 시트(buildCharacterPrompt)가
  // 같은 규칙으로 읽는지 4경우로 본다.
  const storyboard = { subject: "demo" };
  const cutPrompt = (style: object, rules: object) =>
    buildCutPrompt(storyboard, { style, rules } as Parameters<typeof buildCutPrompt>[1]);
  const sheetPrompt = (style: Partial<PresetInput["style"]>) =>
    buildCharacterPrompt({ ...basePreset(), style: { ...basePreset().style, ...style } });

  {
    // 둘 다 없음 — 컷은 문장 생략, 시트는 기본값.
    const cut = cutPrompt({}, {});
    checks.push(["힌트·원본 없음 → 컷에 'Style keywords' 없음", !cut.includes("Style keywords")]);
    checks.push(["힌트·원본 없음 → 컷에 'Do not include' 없음", !cut.includes("Do not include")]);
    checks.push([
      "힌트·원본 없음 → 시트 'default comic style'",
      sheetPrompt({ keywords: [] }).includes("Style keywords: default comic style."),
    ]);
  }
  {
    // 원본만 — 기존 동작 그대로.
    const cut = cutPrompt({ keywords: ["귀여운", "수채화"] }, { forbidden: ["피", "흡연"] });
    checks.push(["원본만 → 컷 원본 키워드", cut.includes("Style keywords: 귀여운, 수채화.")]);
    checks.push(["원본만 → 컷 원본 금지어", cut.includes("Do not include: 피, 흡연.")]);
    checks.push([
      "원본만 → 시트 원본 키워드",
      sheetPrompt({ keywords: ["귀여운", "수채화"] }).includes("Style keywords: 귀여운, 수채화."),
    ]);
  }
  {
    // 힌트만 — 원본이 빠진 프리셋도 힌트를 쓴다.
    const cut = cutPrompt({ keyword_hints: ["cute", "watercolor"] }, { forbidden_hints: ["blood"] });
    checks.push(["힌트만 → 컷 힌트 키워드", cut.includes("Style keywords: cute, watercolor.")]);
    checks.push(["힌트만 → 컷 힌트 금지어", cut.includes("Do not include: blood.")]);
    checks.push([
      "힌트만 → 시트 힌트 키워드",
      sheetPrompt({ keywords: [], keyword_hints: ["cute", "watercolor"] }).includes(
        "Style keywords: cute, watercolor."
      ),
    ]);
  }
  {
    // 둘 다 — 힌트가 이기고 원본 한국어는 프롬프트에 안 나간다.
    const cut = cutPrompt(
      { keywords: ["귀여운", "수채화"], keyword_hints: ["cute", "watercolor"] },
      { forbidden: ["피", "흡연"], forbidden_hints: ["blood", "smoking"] }
    );
    checks.push(["둘 다 → 컷 힌트 키워드", cut.includes("Style keywords: cute, watercolor.")]);
    checks.push(["둘 다 → 컷 힌트 금지어", cut.includes("Do not include: blood, smoking.")]);
    checks.push(["둘 다 → 컷에 원본 한국어 없음", !cut.includes("귀여운") && !cut.includes("흡연")]);
    const sheet = sheetPrompt({ keywords: ["귀여운", "수채화"], keyword_hints: ["cute", "watercolor"] });
    checks.push(["둘 다 → 시트 힌트 키워드", sheet.includes("Style keywords: cute, watercolor.")]);
    checks.push(["둘 다 → 시트에 원본 한국어 없음", !sheet.includes("귀여운")]);
  }
  {
    // 경계: 힌트가 빈 배열이면 `??` 는 원본으로 넘어가지 않는다(계약 그대로). 컷은
    // 문장이 빠지고 시트는 기본값이 된다 — 원본이 있어도 마찬가지.
    const cut = cutPrompt({ keywords: ["귀여운"], keyword_hints: [] }, { forbidden: ["피"], forbidden_hints: [] });
    checks.push(["힌트 [] + 원본 있음 → 컷 키워드 문장 생략", !cut.includes("Style keywords")]);
    checks.push(["힌트 [] + 원본 있음 → 컷 금지어 문장 생략", !cut.includes("Do not include")]);
    checks.push([
      "힌트 [] + 원본 있음 → 시트 'default comic style'",
      sheetPrompt({ keywords: ["귀여운"], keyword_hints: [] }).includes("Style keywords: default comic style."),
    ]);
  }
  {
    // 경계: 금지어 힌트의 빈·공백 원소는 원본과 같이 걸러진다.
    const cut = cutPrompt({}, { forbidden_hints: ["blood", "  ", ""] });
    checks.push(["금지어 힌트 공백 원소 제거", cut.includes("Do not include: blood.")]);
  }

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
}

void main();
