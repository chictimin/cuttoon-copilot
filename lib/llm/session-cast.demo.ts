// session-cast 고정 기본값 fixture (spec-cast rev2 4절 T1~T8).
// 테스트 러너를 추가하지 않는다 — lib/llm/storyboard-guard.demo.ts와 같은 컨벤션.
//
// 실행: npx tsx lib/llm/session-cast.demo.ts

import { mascotOption, NO_SUPPORTING_OPTION } from "./brainstorm-options";
import {
  buildSessionCast,
  DEFAULT_PROTAGONIST_HAIR,
  DEFAULT_PROTAGONIST_HAIR_COLOR,
  pickShirtColor,
  protagonistAppearance,
  SessionCastError,
} from "./session-cast";

let failed = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function desc(
  protagonist: string,
  palette: string[] = ["#112233"],
  random: () => number = () => 0,
): string {
  return buildSessionCast({ protagonist, supporting: null, palette, random }).cast[0]
    .description;
}

// T1 기본값(H4): 머리·옷 언급 없음 → 짧은 검은 머리 + 상의 palette[0], 순서 원문 → 머리 → 상의.
check("const-hair", DEFAULT_PROTAGONIST_HAIR === "짧은 검은 머리");
check("const-color", DEFAULT_PROTAGONIST_HAIR_COLOR === "검은 머리");
check("t1-h4", desc("30대 직장인") === "30대 직장인, 짧은 검은 머리, 상의 #112233");
check(
  "t1-h4-ache",
  desc("머리가 아픈 직장인") === "머리가 아픈 직장인, 짧은 검은 머리, 상의 #112233",
);
check(
  "t1-h4-smart",
  desc("머리 좋은 개발자") === "머리 좋은 개발자, 짧은 검은 머리, 상의 #112233",
);
check("t1-order", protagonistAppearance("30대 직장인", ["#112233"]).join(",") === "짧은 검은 머리,상의 #112233");

// T2 결정성: random 무시 + 입력 불변 + palette 첫 색 고정(대소문자 그대로).
const t2a = [0, 0.1, 0.5, 0.99].map((v) =>
  desc("30대 직장인", ["#AA", "#BB"], () => v),
);
check("t2-random-ignored", t2a.every((x) => x === t2a[0]));
check(
  "t2-throw-random",
  desc("30대 직장인", ["#112233"], () => {
    throw new Error("used");
  }) === "30대 직장인, 짧은 검은 머리, 상의 #112233",
);
const pin = "30대 직장인";
const pal = ["#AA", "#BB"];
desc(pin, pal.slice(), () => 0.1);
check("t2-immutable", pin === "30대 직장인" && pal.length === 2 && pal[0] === "#AA");
check(
  "t2-first-palette",
  buildSessionCast({ protagonist: "30대 직장인", supporting: null, palette: ["#AA", "#BB"] })
    .shirtColor === "#AA",
);
check(
  "t2-hex-case",
  desc("30대 직장인", ["#ff0000"]) === "30대 직장인, 짧은 검은 머리, 상의 #ff0000",
);

// T3 머리색 우선(H2): 머리 조각 없음.
for (const p of ["갈색 머리의 직장인", "금발 대학생", "흰머리 할머니", "머리는 갈색인 디자이너", "검게 염색한 머리 디자이너", "brown-haired student"]) {
  check(`t3-h2:${p}`, desc(p, []) === p, desc(p, []));
}

// T4 스타일만(H3): 검은 머리 1회, 짧은 미포함.
for (const p of ["긴 머리 여성", "포니테일 학생", "곱슬머리 청년", "long hair woman"]) {
  const x = desc(p, []);
  check(`t4-h3:${p}`, x === `${p}, 검은 머리` && x.indexOf("짧은") < 0, x);
}

// T5 무모(H1): 머리 조각 없음.
for (const p of ["대머리 남성", "삭발한 군인", "bald man"]) {
  check(`t5-h1:${p}`, desc(p, []) === p, desc(p, []));
}

// T6 옷 색 우선: 상의 없음 + shirtColor null, 머리 조각은 3-2대로(독립 판정).
for (const p of ["빨간 셔츠를 입은 직장인", "흰 가운 의사", "navy suit designer"]) {
  const o = buildSessionCast({ protagonist: p, supporting: null, palette: ["#112233"] });
  check(
    `t6-clo:${p}`,
    o.cast[0].description === `${p}, 짧은 검은 머리` && o.shirtColor === null,
    o.cast[0].description,
  );
}
check(
  "t6-h3-cloth",
  desc("빨간 셔츠를 입은 긴 머리 여성") === "빨간 셔츠를 입은 긴 머리 여성, 검은 머리",
);

// T7 오탐 0: 티켓·와인 단독·하의는 상의 아님 → 기본값 그대로.
for (const p of ["하얀 티켓을 든 사람", "와인을 좋아하는 직장인", "검은 바지 학생"]) {
  check(`t7-sus:${p}`, desc(p) === `${p}, 짧은 검은 머리, 상의 #112233`, desc(p));
}
check(
  "t7-cross-hair",
  desc("갈색 머리의 직장인") === "갈색 머리의 직장인, 상의 #112233",
);

// T8 범위 밖·중복: 빈 palette·조연 분기·빈 주인공 예외·둘 다 언급.
const emptyPal = buildSessionCast({ protagonist: "30대 직장인", supporting: null, palette: [] });
check(
  "t8-empty-pal",
  emptyPal.cast[0].description === "30대 직장인, 짧은 검은 머리" && emptyPal.shirtColor === null,
);
const free = buildSessionCast({
  protagonist: "30대 직장인",
  supporting: "대학 동창",
  palette: ["#AA"],
});
check(
  "t8-supporting-free",
  free.cast.length === 2 &&
    free.cast[1].description === "대학 동창" &&
    free.cast[0].description === "30대 직장인, 짧은 검은 머리, 상의 #AA",
);
const noneOpt = buildSessionCast({
  protagonist: "30대 직장인",
  supporting: NO_SUPPORTING_OPTION,
  palette: ["#AA"],
});
check("t8-supporting-none", noneOpt.cast.length === 1);
const masc = { label: "호랑이", description: "용맹한 호랑이 마스코트 캐릭터" };
const withMascot = buildSessionCast({
  protagonist: "30대 직장인",
  supporting: mascotOption(masc),
  mascot: masc,
  palette: ["#AA"],
});
check(
  "t8-mascot",
  withMascot.cast.length === 2 && withMascot.cast[1].description === masc.description,
);
let threw = false;
try {
  buildSessionCast({ protagonist: "  ", supporting: null, palette: ["#AA"] });
} catch (err) {
  threw = err instanceof SessionCastError;
}
check("t8-empty-protagonist", threw);
check(
  "t8-dup",
  desc("짧은 검은 머리의 직장인", ["#AA"]) === "짧은 검은 머리의 직장인, 상의 #AA",
);
const both = buildSessionCast({
  protagonist: "갈색 머리에 파란 니트를 입은 직장인",
  supporting: null,
  palette: ["#AA"],
});
check(
  "t8-both",
  both.cast[0].description === "갈색 머리에 파란 니트를 입은 직장인" && both.shirtColor === null,
);

// 호환 export 유지.
check("t-compat-pick", pickShirtColor(["#AA", "#BB"], () => 0.99) === "#BB");
check("t-compat-pick-empty", pickShirtColor([], () => 0) === null);

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log("\n전부 통과");
