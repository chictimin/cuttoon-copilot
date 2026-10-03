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
  const { activeMascot, ratioClause } = await import("./generate");
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
