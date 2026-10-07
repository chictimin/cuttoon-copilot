// spec-259a rev3 대응 demo — 조립 단계 말풍선 위치 맞춤(A) 확인용.
//
// 손으로 적은 가짜 연출 응답만 `applyCutDirections`에 넣어 확인한다.
// 외부 호출·실DB 접근이 없다.
//
// 실행: npx tsx "app/(studio)/session/[id]/storyboard-assembly.demo.ts"

import {
  applyCutDirections,
  assembleStoryboard,
  FLOW_OPTIONS,
} from "./storyboard-assembly";
import type { Cut } from "./storyboard-types";

// spec-259a rev3 2절 매핑표 손표 (구현과 별도로 적음).
const EXPECT: Record<string, Record<string, string>> = {
  top: {
    top_left: "top_left",
    top_right: "top_right",
    bottom_left: "top_left",
    bottom_right: "top_right",
    center: "top_left",
  },
  bottom: {
    top_left: "bottom_left",
    top_right: "bottom_right",
    bottom_left: "bottom_left",
    bottom_right: "bottom_right",
    center: "bottom_left",
  },
  left: {
    top_left: "top_left",
    top_right: "top_left",
    bottom_left: "bottom_left",
    bottom_right: "bottom_left",
    center: "top_left",
  },
  right: {
    top_left: "top_right",
    top_right: "top_right",
    bottom_left: "bottom_right",
    bottom_right: "bottom_right",
    center: "top_right",
  },
};

const ZONES = ["top", "bottom", "left", "right"];
const POSITIONS = ["top_left", "top_right", "bottom_left", "bottom_right", "center"];
const CTA_NAMES = ["none", "soft", "clear"] as const;

let failed = 0;

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fail(name: string, detail: string): void {
  failed++;
  console.error(`FAIL ${name} — ${detail}`);
}

function cloneCuts(cuts: Cut[]): Cut[] {
  return JSON.parse(JSON.stringify(cuts)) as Cut[];
}

function zoneOf(cut: Cut): string | undefined {
  const raw = (cut as unknown as Record<string, unknown>).reserved_zone;
  return typeof raw === "string" ? raw : undefined;
}

// 18조합: 흐름 3 × CTA none·soft·clear × 조연 있음·없음.
let comboCount = 0;
for (let r = 0; r < 18; r++) {
  const flowNo = (r % 3) + 1;
  const flow = FLOW_OPTIONS[r % 3] as string;
  const ctaName = CTA_NAMES[Math.floor(r / 3) % 3] as string;
  const withSupporting = Math.floor(r / 9) % 2 === 1;
  const rowName = `${flowNo} ${ctaName} ${withSupporting ? "with-supporting" : "no-supporting"}`;

  const ctaArg =
    ctaName === "none"
      ? { strength: "none" as const }
      : { strength: ctaName as "soft" | "clear", purpose_id: null };
  const sb = assembleStoryboard(
    "주제",
    { protagonist: "주인공", supporting: withSupporting ? "조연" : null, flow },
    [],
    undefined,
    ctaArg
  );
  const input = cloneCuts(sb.cuts);
  const working = cloneCuts(sb.cuts);
  // 3번째 컷은 그림 있는 컷(E8)으로, 4번째 컷은 zone 키 없음(E9)으로 둔다.
  (working[2] as Cut).generated_image = "asset://demo-259a";
  delete (working[3] as unknown as Record<string, unknown>).reserved_zone;
  const input3 = cloneCuts(working);

  // 가짜 연출 응답 (위치 5종·zone 4종을 행마다 돌려가며 포함).
  const mode = r % 3;
  const dir1: Record<string, unknown> =
    mode === 0
      ? { cut_index: 1, caption_position: POSITIONS[(r + 1) % 5] }
      : mode === 1
        ? { cut_index: 1, reserved_zone: ZONES[r % 4] }
        : {
            cut_index: 1,
            reserved_zone: ZONES[(r + 1) % 4],
            caption_position: POSITIONS[(r + 2) % 5],
          };
  const dirs: unknown[] = [
    dir1,
    {
      cut_index: 3,
      reserved_zone: ZONES[(r + 2) % 4],
      caption_position: POSITIONS[(r + 3) % 5],
      shot_type: "wide",
    },
    { cut_index: 4, caption_position: POSITIONS[(r + 4) % 5] },
  ];
  const out = applyCutDirections(working, dirs, []);

  // 1번째 컷(E4·E5·E6): zone = 연출 zone(없으면 기존), position = 손표 값.
  const in1 = input3[0] as Cut;
  const out1 = out[0] as Cut;
  const finalZone1 = (dir1.reserved_zone as string | undefined) ?? zoneOf(in1);
  const candidate1 = (dir1.caption_position as string | undefined) ?? in1.caption.position;
  if (finalZone1 === undefined) {
    fail(rowName, "cut1 final zone 없음");
  } else {
    const wantZone = (dir1.reserved_zone as string | undefined) ?? zoneOf(in1);
    const wantPos = EXPECT[finalZone1]?.[candidate1];
    if (out1.reserved_zone !== wantZone || out1.caption.position !== wantPos) {
      fail(
        rowName,
        `cut1 zone=${String(out1.reserved_zone)}/${String(wantZone)} pos=${out1.caption.position}/${String(wantPos)}`
      );
    }
  }
  // 2번째 컷(E3): 연출 없음 → 입력과 deepEqual.
  if (!eq(out[1], input3[1])) fail(rowName, "cut2(E3) 변경됨");
  // 3번째 컷(E8): 연출 zone 무시, zone = 기존, position = 손표(기존 zone, 연출 position).
  // 다른 유효 연출 필드(shot_type)는 적용.
  const in3 = input3[2] as Cut;
  const out3 = out[2] as Cut;
  const base3 = zoneOf(in3);
  if (base3 === undefined) {
    fail(rowName, "cut3 기존 zone 없음");
  } else {
    const wantPos3 = EXPECT[base3]?.[POSITIONS[(r + 3) % 5] as string];
    if (
      out3.reserved_zone !== base3 ||
      out3.caption.position !== wantPos3 ||
      out3.shot_type !== "wide" ||
      out3.generated_image !== "asset://demo-259a"
    ) {
      fail(rowName, `cut3(E8) zone=${String(out3.reserved_zone)} pos=${out3.caption.position}`);
    }
  }
  // 4번째 컷(E9): 매핑 없음. 유효 연출 position 그대로 + zone 키 그대로 없음.
  const out4 = out[3] as Cut;
  const wantPos4 = POSITIONS[(r + 4) % 5];
  const hasZoneKey4 = "reserved_zone" in (out4 as unknown as Record<string, unknown>);
  if (out4.caption.position !== wantPos4 || hasZoneKey4) {
    fail(rowName, `cut4(E9) pos=${out4.caption.position} zoneKey=${String(hasZoneKey4)}`);
  }
  // 입력 snapshot 불변 (E1~E3 해당 컷은 손대지 않음).
  if (!eq(input, sb.cuts)) fail(rowName, "assemble 입력 변경됨");

  comboCount++;
  console.log(`ok ${rowName}`);
}

// E1: 연출 전체 없음 → 입력과 동일 참조.
{
  const sb = assembleStoryboard(
    "주제",
    { protagonist: "주인공", supporting: null, flow: FLOW_OPTIONS[0] as string },
    [],
    undefined,
    { strength: "none" }
  );
  if (applyCutDirections(sb.cuts, [], []) !== sb.cuts) fail("E1", "동일 참조 아님");
}

// E2: fallback 컷 → 그대로.
{
  const sb = assembleStoryboard(
    "주제",
    { protagonist: "주인공", supporting: null, flow: FLOW_OPTIONS[0] as string },
    [],
    undefined,
    { strength: "none" }
  );
  const before = cloneCuts(sb.cuts);
  const out = applyCutDirections(
    sb.cuts,
    [{ cut_index: 1, reserved_zone: "bottom", caption_position: "bottom_right" }],
    [1]
  );
  if (!eq(out[0], before[0])) fail("E2", "fallback 컷 변경됨");
}

// E7: 다른 필드만 있는 연출 → zone = 기존, position = 손표(기존 zone, 기존 position).
{
  const sb = assembleStoryboard(
    "주제",
    { protagonist: "주인공", supporting: null, flow: FLOW_OPTIONS[0] as string },
    [],
    undefined,
    { strength: "none" }
  );
  const before = cloneCuts(sb.cuts);
  const out = applyCutDirections(sb.cuts, [{ cut_index: 1, shot_type: "wide" }], []);
  const z = zoneOf(before[0] as Cut);
  const want = z === undefined ? (before[0] as Cut).caption.position : EXPECT[z]?.[(before[0] as Cut).caption.position];
  if (out[0]?.shot_type !== "wide" || out[0]?.caption.position !== want) {
    fail("E7", `pos=${String(out[0]?.caption.position)}/${String(want)}`);
  }
}

// 다시 뽑기: 한 컷 연출만 → 그 컷만 E6 판정, 다른 컷 입력 deepEqual.
{
  const sb = assembleStoryboard(
    "주제",
    { protagonist: "주인공", supporting: "조연", flow: FLOW_OPTIONS[1] as string },
    [],
    undefined,
    { strength: "clear", purpose_id: null }
  );
  const before = cloneCuts(sb.cuts);
  const out = applyCutDirections(
    sb.cuts,
    [{ cut_index: 2, reserved_zone: "right", caption_position: "center" }],
    []
  );
  const base2 = zoneOf(before[1] as Cut);
  void base2;
  const wantRegen = EXPECT["right"]?.["center"];
  const cut2 = out[1] as Cut;
  const othersSame =
    eq(out[0], before[0]) && eq(out[2], before[2]) && eq(out[3], before[3]);
  if (cut2.reserved_zone !== "right" || cut2.caption.position !== wantRegen || !othersSame) {
    fail("REGEN-single-cut", `pos=${cut2.caption.position}/${String(wantRegen)} others=${String(othersSame)}`);
  } else {
    console.log("ok REGEN-single-cut");
  }
}

if (comboCount === 18 && failed === 0) {
  console.log("ok 18조합");
} else {
  fail("18조합", `count=${comboCount} failed=${failed}`);
}

if (failed > 0) {
  console.error(`259A-PATHS ${failed}건 실패`);
  process.exit(1);
}
console.log("OK 259A-PATHS");
