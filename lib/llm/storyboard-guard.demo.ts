// assertStoryboardRuntimeInvariants 세 체크(cut_index 유일성 · cta_override 유효성 ·
// cta 비트 개수/위치, #28)를 실제로 호출해 확인하는 스크립트. 테스트 러너를 추가하지
// 않는다 — lib/render/demo.ts와 같은 컨벤션.
//
// 실행: npx tsx lib/llm/storyboard-guard.demo.ts

import {
  assertStoryboardRuntimeInvariants,
  storyboardContractProblems,
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

// ---- P1-a (spec-263 3-1·5-1): storyboardContractProblems 확인 ----
// 정본 어휘(stand·top_left…·shot_type 있음)로 지은 정상형은 problem 0,
// 5-1 행렬의 위반 fixture는 해당 rule prefix를 낸다. throw는 절대 없음.

type Board = Record<string, unknown>;
type Cut = Record<string, unknown>;

const FLOW_BEATS: string[][] = [
  ["hook", "problem", "solution", "cta"],
  ["question", "fact", "benefit", "cta"],
  ["before", "turning", "after", "cta"],
];
const NO_CTA_BEATS = ["hook", "problem", "solution", "after"];
const SHOTS = ["closeup", "full", "waist", "wide"];
const ANGLES: string[] = ["eye", "eye", "eye", "low"];
const POSITIONS = ["top_left", "top_right", "bottom_left", "bottom_right"];

function demoCut(i: number, beat: string, frameIds: string[]): Cut {
  return {
    cut_index: i,
    narrative_beat: beat,
    shot_type: SHOTS[i - 1],
    camera_angle: ANGLES[i - 1],
    characters_in_frame: frameIds.map((id) => ({
      character_id: id,
      expression: "neutral",
      pose: "stand",
    })),
    caption: { text: `대사${i}`, position: POSITIONS[i - 1], bubble_type: "rounded" },
    generated_image: null,
    cta_override: beat === "cta" ? null : null,
  };
}

function demoBoard(beats: string[], strength: string, supporting: boolean): Board {
  const cast: unknown[] = [
    { character_id: "a", role: "protagonist", description: "주인공" },
  ];
  if (supporting) {
    cast.push({ character_id: "b", role: "supporting", description: "조연" });
  }
  return {
    storyboard_version: "1.0",
    subject: "소재",
    cast,
    cuts: beats.map((beat, k) =>
      demoCut(k + 1, beat, k === 2 && supporting ? ["a", "b"] : ["a"])
    ),
    cta_strength: strength,
  };
}

function cutsOf(board: Board): Cut[] {
  return board.cuts as Cut[];
}

function expectProblems(name: string, board: unknown, rulePrefix: string | null): void {
  const found = storyboardContractProblems(board);
  const ok =
    rulePrefix === null
      ? found.length === 0
      : found.some((p) => p.rule.indexOf(rulePrefix) === 0);
  if (ok) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name} — problems: ${JSON.stringify(found).slice(0, 400)}`);
  }
}

function expectNoRule(
  name: string,
  board: unknown,
  ctx: { demoCacheValues?: ReadonlySet<string> },
  rule: string
): void {
  const found = storyboardContractProblems(board, ctx).filter((p) => p.rule === rule);
  if (found.length === 0) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name} — problems: ${JSON.stringify(found).slice(0, 400)}`);
  }
}

// 정상 경로 18조합(흐름 3 × CTA 3 × 조연 2) → problem 0
for (const beats of [FLOW_BEATS[0], FLOW_BEATS[1], FLOW_BEATS[2]]) {
  for (const strength of ["clear", "soft"]) {
    for (const supporting of [false, true]) {
      expectProblems(`정상 ${beats[0]}·${strength}·조연${supporting ? "유" : "무"}`, demoBoard(beats, strength, supporting), null);
    }
  }
}
for (const supporting of [false, true]) {
  expectProblems(`정상 none·조연${supporting ? "유" : "무"}`, demoBoard(NO_CTA_BEATS, "none", supporting), null);
}

// 가짜 모델 응답으로 대사·연출 적용 후 → problem 0
{
  const b = demoBoard(FLOW_BEATS[0], "clear", true);
  const c0 = cutsOf(b)[0];
  (c0.caption as Cut).text = "모델이 고친 대사";
  (c0.characters_in_frame as Cut[])[0].expression = "smile";
  (c0.characters_in_frame as Cut[])[0].pose = "walk";
  c0.shot_type = "bust";
  expectProblems("정상 가짜모델 적용 후", b, null);
}

// 에디터 말풍선 위치 변경 후 → problem 0
{
  const b = demoBoard(FLOW_BEATS[1], "soft", false);
  (cutsOf(b)[1].caption as Cut).position = "center";
  expectProblems("정상 위치 편집 후", b, null);
}

// 위반 fixture → 해당 rule
{
  const base = () => demoBoard(FLOW_BEATS[0], "clear", false);
  const withCut0 = (patch: Cut): Board => {
    const b = base();
    cutsOf(b)[0] = { ...cutsOf(b)[0], ...patch };
    return b;
  };
  expectProblems("A1 숫자", withCut0({ generated_image: 123 } as unknown as Cut), "A1");
  expectProblems("A1 빈문자", withCut0({ generated_image: "" } as unknown as Cut), "A1");
  expectProblems("A1 asset://만", withCut0({ generated_image: "asset://" } as unknown as Cut), "A1");
  expectProblems("A1 stub", withCut0({ generated_image: "stub-x" } as unknown as Cut), "A1");
  expectProblems("A1 https", withCut0({ generated_image: "https://x" } as unknown as Cut), "A1");
  expectProblems(
    "A1 캐시밖(ctx 없음)",
    withCut0({ generated_image: "/demo-cache/EVIL.png" } as unknown as Cut),
    "A1"
  );
  expectNoRule(
    "A1 캐시허용(ctx 있음)",
    withCut0({ generated_image: "/demo-cache/cut1.png" } as unknown as Cut),
    { demoCacheValues: new Set(["/demo-cache/cut1.png"]) },
    "A1"
  );
  const cacheOut = withCut0({ generated_image: "/demo-cache/other.png" } as unknown as Cut);
  expectProblems("A1 캐시밖(ctx 있어도)", cacheOut, "A1");

  const v2 = base();
  v2.storyboard_version = "2.0";
  expectProblems("A2 버전", v2, "A2");
  const v3 = base();
  v3.storyboard_version = 123;
  expectProblems("A2 타입", v3, "A2");

  const c0 = base();
  c0.cast = [];
  expectProblems("A3 빈cast", c0, "A3");
  const c3 = base();
  c3.cast = [
    { character_id: "a", role: "protagonist", description: "d" },
    { character_id: "b", role: "supporting", description: "e" },
    { character_id: "c", role: "supporting", description: "f" },
  ];
  expectProblems("A3 3명", c3, "A3");
  const c2p = base();
  c2p.cast = [
    { character_id: "a", role: "protagonist", description: "d" },
    { character_id: "b", role: "protagonist", description: "e" },
  ];
  expectProblems("A3 주인공2명", c2p, "A3");
  const c0p = base();
  c0p.cast = [{ character_id: "a", role: "supporting", description: "d" }];
  expectProblems("A3 주인공0명", c0p, "A3");

  const r1 = base();
  (r1.cast as Cut[])[0].role = "boss";
  expectProblems("A12 role 오타", r1, "A12");
  const r2 = base();
  (r2.cast as Cut[])[0].description = 123;
  expectProblems("A12 description 타입", r2, "A12");

  const n3 = base();
  n3.cuts = cutsOf(n3).slice(0, 3);
  expectProblems("A4 3컷", n3, "A4");

  const m1 = base();
  const mc1 = cutsOf(m1)[1];
  delete mc1.shot_type;
  expectProblems("A5 shot 누락", m1, "A5");
  const m2 = base();
  const mc2 = cutsOf(m2)[1];
  delete mc2.caption;
  expectProblems("A5 caption 누락", m2, "A5");

  const i1 = withCut0({ cut_index: 1.5 } as unknown as Cut);
  expectProblems("A7 소수", i1, "A7");
  const i0 = withCut0({ cut_index: 0 } as unknown as Cut);
  expectProblems("A7 범위밖", i0, "A7");
  const dup = base();
  cutsOf(dup)[1].cut_index = 1;
  expectProblems("A7 중복", dup, "A7");

  const e1 = withCut0({ narrative_beat: "폭발" } as unknown as Cut);
  expectProblems("A6 beat 오타", e1, "A6");
  const e2 = withCut0({ shot_type: "초접사" } as unknown as Cut);
  expectProblems("A6 shot 오타", e2, "A6");

  const t1 = withCut0({ time_of_day: "새벽녘" } as unknown as Cut);
  expectProblems("A14 time 오타", t1, "A14");

  const u1 = base();
  ((cutsOf(u1)[0].characters_in_frame as Cut[])[0] as Cut).character_id = "zzz";
  expectProblems("A9 cast밖 id", u1, "A9");

  const p1 = base();
  ((cutsOf(p1)[0].characters_in_frame as Cut[])[0] as Cut).pose = "날아다님";
  expectProblems("A6 pose 오타", p1, "A6");
  const p2 = base();
  (cutsOf(p2)[0].caption as Cut).position = "어딘가";
  expectProblems("A6 position 오타", p2, "A6");
  const p3 = base();
  (cutsOf(p3)[0].caption as Cut).text = 123;
  expectProblems("A5 caption text 타입", p3, "A5");

  const w2 = base();
  cutsOf(w2)[0].narrative_beat = "cta";
  cutsOf(w2)[0].cta_override = null;
  expectProblems("CTA 2개", w2, "CTA");
  const w0 = base();
  cutsOf(w0)[0].narrative_beat = "cta";
  cutsOf(w0)[0].cta_override = null;
  cutsOf(w0)[3].narrative_beat = "after";
  expectProblems("CTA 위치", w0, "CTA");

  const s1 = base();
  s1.cta_strength = "강하게";
  expectProblems("A10 강도 오타", s1, "A10");

  const g1 = base();
  g1.subject_tags = [{ raw: "태그" }];
  expectProblems("A11 태그", g1, "A11");

  // spec-242 SPK·ANC (A-5·B) — 2인 컷(조연 있음, 3번 컷) 정상 + 위반
  const spkOk = demoBoard(FLOW_BEATS[0], "clear", true);
  (cutsOf(spkOk)[2].caption as Cut).speaker_index = 1;
  (cutsOf(spkOk)[2].caption as Cut).anchor = { x: 0.5, y: 0.5 };
  expectProblems("SPK·ANC 정상(2인 컷)", spkOk, null);
  const spkSolo = demoBoard(FLOW_BEATS[0], "clear", false);
  (cutsOf(spkSolo)[0].caption as Cut).speaker_index = 0;
  expectProblems("SPK 1인 컷 키 있음", spkSolo, "SPK");
  const spkEnum = demoBoard(FLOW_BEATS[0], "clear", true);
  (cutsOf(spkEnum)[2].caption as Cut).speaker_index = 2;
  expectProblems("SPK 범위 밖", spkEnum, "SPK");
  const ancRange = demoBoard(FLOW_BEATS[0], "clear", false);
  (cutsOf(ancRange)[0].caption as Cut).anchor = { x: 1.5, y: 0.5 };
  expectProblems("ANC 범위 밖", ancRange, "ANC");
  const ancExtra = demoBoard(FLOW_BEATS[0], "clear", false);
  (cutsOf(ancExtra)[0].caption as Cut).anchor = { x: 0.5, y: 0.5, z: 1 };
  expectProblems("ANC 추가 키", ancExtra, "ANC");

  // frame locator 회귀(spec-263 rev5 3-1 "frame" 줄) — 인물에 묶인 식별자
  const f1 = demoBoard(FLOW_BEATS[0], "clear", false);
  ((cutsOf(f1)[0].characters_in_frame as Cut[])[0] as Cut).expression = "smil";
  const fp = storyboardContractProblems(f1).find((p) => p.rule === "A6");
  if (fp !== undefined && fp.locator === "cut#1.frame#a.expression") {
    console.log("ok   frame locator 안정");
  } else {
    failed++;
    console.error(`FAIL frame locator 안정 — ${JSON.stringify(fp)}`);
  }
  const f2 = demoBoard(FLOW_BEATS[0], "clear", false);
  ((cutsOf(f2)[0].characters_in_frame as Cut[])[0] as Cut).character_id = "zzz";
  const fp2 = storyboardContractProblems(f2).find((p) => p.rule === "A9");
  if (fp2 !== undefined && fp2.locator === "cut#1.frame#zzz.character_id") {
    console.log("ok   A9 frame locator");
  } else {
    failed++;
    console.error(`FAIL A9 frame locator — ${JSON.stringify(fp2)}`);
  }
  const f3 = demoBoard(FLOW_BEATS[0], "clear", false);
  const fr3 = cutsOf(f3)[0].characters_in_frame as Cut[];
  fr3.push({ character_id: "a", expression: "smile", pose: "stand" });
  (fr3[0] as Cut).expression = "smil";
  const fp3 = storyboardContractProblems(f3).find(
    (p) => p.rule === "A6" && p.locator.indexOf("frame[0]!") >= 0
  );
  if (fp3 !== undefined && fp3.locator === "cut#1.frame[0]!.expression") {
    console.log("ok   frame locator 불안정");
  } else {
    failed++;
    console.error(`FAIL frame locator 불안정 — ${JSON.stringify(fp3)}`);
  }

  // throw 금지
  try {
    storyboardContractProblems(null);
    storyboardContractProblems("x");
    storyboardContractProblems({});
    storyboardContractProblems({ cast: null, cuts: null });
    console.log("ok   throw 금지");
  } catch {
    failed++;
    console.error("FAIL throw 금지 — 예외 발생");
  }
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log("\n계약 판정 추가분 통과");
