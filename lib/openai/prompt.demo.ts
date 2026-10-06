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

  // --- 5. #206 소재 [브랜드] 투영 (buildCutPrompt) ---
  // 그림 프롬프트에 대괄호 원문(브랜드)이 0회 나가야 한다. 매칭 기준은 투영 함수와 같이
  // 대소문자·공백 무시라, 검사도 같은 정규화로 본다. 브랜드는 예시 이름이다.
  type CutStoryboard = Parameters<typeof buildCutPrompt>[0];
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, "");
  const leaks = (prompt: string, raw: string) => norm(prompt).includes(norm(raw));
  const cut1 = {
    cut_index: 1,
    narrative_beat: "problem",
    characters_in_frame: [{ character_id: "protagonist", expression: "worried", pose: "stand" }],
  };
  const tagged = (subject: string | undefined, desc: string, subject_tags?: unknown): string =>
    buildCutPrompt(
      {
        subject,
        cast: [{ character_id: "protagonist", role: "protagonist", description: desc }],
        cuts: [cut1],
        subject_tags,
      } as CutStoryboard,
      {},
      cut1
    );

  {
    // 대괄호 소재 + 태그 → category
    const p = tagged("[블루핏 앱]으로 무릎 관리", "블루핏 앱을 매일 켜는 50대 여성", [
      { raw: "블루핏 앱", category: "운동 앱" },
    ]);
    checks.push(["태그 있음 → 소재 문장 category", p.includes("The story is about 운동 앱으로 무릎 관리. ")]);
    checks.push(["태그 있음 → cast 서술 category", p.includes("Character: 운동 앱을 매일 켜는 50대 여성. ")]);
    checks.push(["태그 있음 → 원문 0회", !leaks(p, "블루핏 앱") && !leaks(p, "블루핏")]);
  }
  {
    // 대괄호 소재 + 태그 없음(옛 세션·화면 미배선) → "제품"
    const p = tagged("[블루핏 앱]으로 무릎 관리", "블루핏 앱을 매일 켜는 50대 여성");
    checks.push(["태그 없음 → 소재 문장 '제품'", p.includes("The story is about 제품으로 무릎 관리. ")]);
    checks.push(["태그 없음 → cast 서술 '제품'", p.includes("Character: 제품을 매일 켜는 50대 여성. ")]);
    checks.push(["태그 없음 → 원문 0회", !leaks(p, "블루핏")]);
  }
  {
    // 대괄호 없는 소재 → 소재·서술이 원문 그대로(기존과 같은 문장)
    const p = tagged("무릎 연골 나감", "짧은 회색 머리의 60대 어머니");
    checks.push(["대괄호 없음 → 소재 그대로", p.includes("The story is about 무릎 연골 나감. ")]);
    checks.push(["대괄호 없음 → 서술 그대로", p.includes("Character: 짧은 회색 머리의 60대 어머니. ")]);
  }
  {
    // cast 서술의 공백·대소문자 변형도 투영된다("New Balance" ↔ "newbalance"·"NEW  BALANCE")
    const p = tagged(
      "[New Balance] 운동화로 출근",
      "newbalance 운동화를 신은 30대 남성, NEW  BALANCE 로고 모자",
      [{ raw: "New Balance", category: "운동화 브랜드" }]
    );
    checks.push(["변형 → 원문 0회", !leaks(p, "New Balance")]);
    checks.push([
      "변형 → 서술 두 곳 모두 category",
      p.includes("Character: 운동화 브랜드 운동화를 신은 30대 남성, 운동화 브랜드 로고 모자. "),
    ]);
  }
  {
    // 태그 개수 초과(4번째)·category에 원문을 담은 경우도 "제품"으로 막힌다
    const p = tagged("[A사] [B사] [C사] [D사] 비교", "D사 점퍼를 입은 사람", [
      { raw: "A사", category: "A사 앱" },
      { raw: "B사", category: "은행" },
      { raw: "C사", category: "카드" },
    ]);
    checks.push(["4번째 태그·원문 category → 원문 0회", ["A사", "D사"].every((r) => !leaks(p, r))]);
  }
  {
    // 형태가 어긋난 subject_tags(category 숫자) → 죽지 않고 "제품"
    let p = "";
    try {
      p = tagged("[블루핏 앱] 후기", "평범한 직장인", [{ raw: "블루핏 앱", category: 3 }]);
    } catch {
      p = "";
    }
    checks.push(["잘못된 subject_tags → '제품'", p.includes("The story is about 제품 후기. ")]);
  }
  {
    // 소재가 비면 기존 기본 문장
    const p = tagged(undefined, "평범한 직장인");
    checks.push([
      "소재 없음 → 기본 문장",
      p.includes("The story is about a person dealing with an everyday situation. "),
    ]);
  }

  // --- 6. #240 체이닝 컷 머리색 유지 ---
  {
    const sb = {
      subject: "demo",
      cast: [{ character_id: "protagonist", role: "protagonist", description: "30대 직장인" }],
    } as CutStoryboard;
    const withChar = {
      cut_index: 2,
      characters_in_frame: [{ character_id: "protagonist", expression: "smile", pose: "stand" }],
    };
    const KEEP = "Never change anyone's hair color between panels.";
    checks.push(["체이닝 컷 → 머리색 유지 문장", buildCutPrompt(sb, {}, withChar, { continuesChain: true }).includes(KEEP)]);
    checks.push(["체이닝 아님(표지·첫 컷) → 문장 없음", !buildCutPrompt(sb, {}, withChar).includes(KEEP)]);
    checks.push([
      "체이닝이어도 인물 없는 컷 → 문장 없음",
      !buildCutPrompt(sb, {}, { cut_index: 3, characters_in_frame: [] }, { continuesChain: true }).includes(KEEP),
    ]);
    checks.push(["cut 없음 → 문장 없음", !buildCutPrompt(sb, {}, undefined, { continuesChain: true }).includes(KEEP)]);
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
