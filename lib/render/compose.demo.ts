// captionSvg()의 POSITION_BOX 폴백(#70)이 실제로 크래시를 막는지, 그리고 폴백된
// 값이 box·shape·tail 전부에 일관되게 쓰이는지(#79) 확인하는 스크립트.
// storyboard.schema.json enum 밖의 값은 저장 시점 검증을 뚫고 들어올 수 있으므로
// (app/api/session/validate.ts, #70/#79 이슈 참고) 타입을 `as Position`으로 우회해 재현한다.
// #199: center 꼬리가 화자 방향을 향하는지, 기본 목표점(몸통 안)에서는 예전 고정 꼬리 그대로인지도 본다.
// #242 (가): 2인 컷 화자(speaker_index) 목표점과, Export 경로에서 화자별로 꼬리가 달라지는지도 본다.
// #242: 에디터에서 끌어 놓은 좌표(caption.anchor)를 몸통 중심으로 쓰는지(폭 0.44, 보정 없음, 잘못된 값 무시, 꼬리는 화자 쪽)도 본다.
//
// 실행: npx tsx lib/render/compose.demo.ts

import sharp from "sharp";
import { composeCut, headTargetForCut, headTargetForShot, resolveTail, type HeadTarget } from "./compose";
import type { Caption, Position } from "./types";

async function blankImage(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 240, g: 240, b: 240 } },
  })
    .png()
    .toBuffer();
}

async function main() {
  const img = await blankImage();
  let failed = 0;

  // 정상 값 — 기존 동작 유지 확인
  try {
    const caption: Caption = { text: "정상 케이스", bubble_type: "rounded", position: "top_left" };
    await composeCut(img, [caption]);
    console.log("ok   정상 position (top_left)");
  } catch (err) {
    failed++;
    console.error(`FAIL 정상 position — ${(err as Error).message}`);
  }

  // enum 밖의 값 — #70 이전에는 box.x에서 undefined 참조로 크래시
  try {
    const caption = {
      text: "스키마 밖 값",
      bubble_type: "rounded",
      position: "middle_center" as unknown as Position,
    } satisfies Caption;
    await composeCut(img, [caption]);
    console.log("ok   enum 밖 position (\"middle_center\") — center로 폴백, 크래시 없음");
  } catch (err) {
    failed++;
    console.error(`FAIL enum 밖 position — 크래시함: ${(err as Error).message}`);
  }

  // 프로토타입 키("toString"·"constructor"·"__proto__")도 enum 밖 값이다 — `in` 검사로는 통과해서
  // box가 함수/객체가 되고 좌표가 NaN이 됐다(#277 리뷰). 명시적 center와 같은 그림이어야 한다.
  try {
    const center = await composeCut(img, [{ text: "프로토타입 키", bubble_type: "rounded", position: "center" }]);
    for (const key of ["toString", "constructor", "__proto__"]) {
      const out = await composeCut(img, [{ text: "프로토타입 키", bubble_type: "rounded", position: key as unknown as Position }]);
      if (Buffer.compare(center, out) === 0) {
        console.log(`ok   position "${key}" — center로 폴백`);
      } else {
        failed++;
        console.error(`FAIL position "${key}" — center와 다르게 그려짐`);
      }
    }
  } catch (err) {
    failed++;
    console.error(`FAIL 프로토타입 키 position — ${(err as Error).message}`);
  }

  // #79: box만 center로 폴백하고 tailSvg()엔 원본을 그대로 넘기면, 몸통은 center
  // 자리인데 꼬리는 (center가 아니라서) 그려지는 불일치가 생긴다. position="center"로
  // 명시한 것과 enum 밖 값으로 center에 떨어진 것의 렌더링 결과가 완전히 같아야
  // (꼬리 없음 포함) 폴백이 값 하나로 일관되게 적용된 것이다.
  try {
    const explicitCenter: Caption = { text: "동일 텍스트", bubble_type: "rounded", position: "center" };
    const fallbackToCenter = {
      text: "동일 텍스트",
      bubble_type: "rounded",
      position: "nonsense_value" as unknown as Position,
    } satisfies Caption;

    const [a, b] = await Promise.all([
      composeCut(img, [explicitCenter]),
      composeCut(img, [fallbackToCenter]),
    ]);

    if (Buffer.compare(a, b) === 0) {
      console.log("ok   center 폴백이 명시적 center와 완전히 동일하게 렌더링됨 (꼬리 불일치 없음)");
    } else {
      failed++;
      console.error("FAIL center 폴백 결과가 명시적 center와 다름 — box/tail이 서로 다른 값을 기준으로 그려짐");
    }
  } catch (err) {
    failed++;
    console.error(`FAIL center 폴백 비교 — ${(err as Error).message}`);
  }

  // #199: center 꼬리 — 목표점이 몸통 밖이면 그쪽을 향하고, 몸통 안이면 고정 꼬리로 폴백한다.
  // 캔버스 1000×1000, 몸통 중심 (500, 450), 반폭 280·반높이 70 기준.
  {
    const dirs: [string, HeadTarget, (cos: number, sin: number) => boolean][] = [
      ["왼쪽", { x: 0.1, y: 0.45 }, (c) => c < -0.9],
      ["오른쪽", { x: 0.9, y: 0.45 }, (c) => c > 0.9],
      ["위", { x: 0.5, y: 0.1 }, (_, s) => s < -0.9],
      ["아래", { x: 0.5, y: 0.9 }, (_, s) => s > 0.9],
    ];
    for (const shape of ["ellipse", "box"] as const) {
      for (const [name, target, ok] of dirs) {
        const t = resolveTail("center", shape, 500, 450, 280, 70, 1000, 1000, target);
        if (t.fixedProtrude === undefined && ok(Math.cos(t.angle), Math.sin(t.angle))) {
          console.log(`ok   center 꼬리 ${shape} — 화자가 ${name}에 있으면 그쪽을 향함`);
        } else {
          failed++;
          console.error(`FAIL center 꼬리 ${shape} — 화자가 ${name}인데 각도 ${t.angle.toFixed(2)}, 고정=${t.fixedProtrude !== undefined}`);
        }
      }
      const inside = resolveTail("center", shape, 500, 450, 280, 70, 1000, 1000, { x: 0.55, y: 0.47 });
      if (inside.fixedProtrude !== undefined) {
        console.log(`ok   center 꼬리 ${shape} — 목표점이 몸통 안이면 고정 꼬리로 폴백`);
      } else {
        failed++;
        console.error(`FAIL center 꼬리 ${shape} — 목표점이 몸통 안인데 고정 꼬리로 폴백하지 않음`);
      }
    }
  }

  // #199 회귀: headTarget을 안 넘긴 center(지금의 Export)는 기본 목표점이 몸통 안이라 결과가 그대로여야 한다
  // — 기본 목표점을 명시적으로 넘긴 것, 몸통 안의 다른 점을 넘긴 것과 렌더 결과가 같아야 한다.
  try {
    const long: Caption = {
      text: "아침마다 무릎이 뻣뻣해서 계단 내려갈 때마다 조심하게 되는데 스트레칭을 하면 정말 좀 나아질까 궁금해요",
      bubble_type: "rounded",
      position: "center",
    };
    for (const caption of [long, { ...long, bubble_type: "rect" } satisfies Caption]) {
      const [a, b, c] = await Promise.all([
        composeCut(img, [caption]),
        composeCut(img, [caption], [{ x: 0.5, y: 0.42 }]),
        composeCut(img, [caption], [{ x: 0.52, y: 0.45 }]),
      ]);
      if (Buffer.compare(a, b) === 0 && Buffer.compare(a, c) === 0) {
        console.log(`ok   center ${caption.bubble_type} 긴 대사 — headTarget 생략·몸통 안 목표점 모두 기존 고정 꼬리와 동일`);
      } else {
        failed++;
        console.error(`FAIL center ${caption.bubble_type} 긴 대사 — 몸통 안 목표점인데 렌더 결과가 달라짐`);
      }
    }
  } catch (err) {
    failed++;
    console.error(`FAIL center 회귀 비교 — ${(err as Error).message}`);
  }

  // #242 (나): shot_type별 목표점 — wide만 아래로, full·나머지·없음·이상값은 기본(undefined).
  {
    const wide = headTargetForShot("wide"), full = headTargetForShot("full");
    const rest = ["full", "closeup", "bust", "waist", "", "constructor", "toString"].map((s) => headTargetForShot(s));
    if (wide?.y === 0.55 && full === undefined && wide.x === 0.5 && rest.every((t) => t === undefined)
        && headTargetForShot(null) === undefined && headTargetForShot(undefined) === undefined) {
      console.log("ok   shot_type 목표점 — wide 0.55, full·나머지·없음·이상값은 기본");
    } else {
      failed++;
      console.error(`FAIL shot_type 목표점 — wide=${JSON.stringify(wide)} full=${JSON.stringify(full)}`);
    }
  }

  // #242 (나): 같은 top_left 말풍선에서 wide 목표점이 꼬리를 더 아래로 향하게 하는지(각도가 커짐).
  {
    const base = resolveTail("top_left", "ellipse", 250, 150, 200, 60, 1000, 1000, { x: 0.5, y: 0.42 });
    const low = resolveTail("top_left", "ellipse", 250, 150, 200, 60, 1000, 1000, headTargetForShot("wide")!);
    if (low.angle > base.angle) {
      console.log(`ok   wide 꼬리 방향 — 기본 ${(base.angle * 180 / Math.PI).toFixed(1)}° → wide ${(low.angle * 180 / Math.PI).toFixed(1)}° (더 아래)`);
    } else {
      failed++;
      console.error("FAIL wide 꼬리 방향 — 아래로 내려가지 않음");
    }
  }

  // #242 (나): 목표점을 넘긴 합성이 기본과 다른 그림을 만들고 예외 없이 끝나는지.
  try {
    const caption: Caption = { text: "먼 거리 컷 꼬리", bubble_type: "rounded", position: "top_left" };
    const [a, b] = await Promise.all([composeCut(img, [caption]), composeCut(img, [caption], [headTargetForShot("wide")])]);
    if (Buffer.compare(a, b) !== 0) {
      console.log("ok   wide 목표점 합성 — 기본 꼬리와 다른 결과");
    } else {
      failed++;
      console.error("FAIL wide 목표점 합성 — 기본과 같은 결과");
    }
  } catch (err) {
    failed++;
    console.error(`FAIL wide 목표점 합성 — ${(err as Error).message}`);
  }

  // #242 (가): 2인 컷 화자 목표점 — 0은 왼쪽(30%), 1은 오른쪽(70%), 세로는 shot_type 보정 그대로.
  // 1인 컷·화자 없음·0/1이 아닌 값(과거 저장본·저장 검사 밖 값)은 headTargetForShot()과 같아야 한다.
  {
    const two = [{}, {}], one = [{}];
    const cap = (s?: unknown): Caption => ({ text: "화자", bubble_type: "rounded", position: "top_right", ...(s === undefined ? {} : { speaker_index: s as number }) });
    const t = (s: unknown, frame: unknown[] | null, shot: string | null = "bust") => headTargetForCut({ caption: cap(s), shot_type: shot, characters_in_frame: frame });
    const same = (a: HeadTarget | undefined, b: HeadTarget | undefined) => JSON.stringify(a) === JSON.stringify(b);
    const cases: [string, boolean][] = [
      ["2인 0 → 왼쪽 0.3", same(t(0, two), { x: 0.3, y: 0.42 })],
      ["2인 1 → 오른쪽 0.7", same(t(1, two), { x: 0.7, y: 0.42 })],
      ["wide 2인 1 → 0.7·0.55", same(t(1, two, "wide"), { x: 0.7, y: 0.55 })],
      ["1인 0 → 무시", same(t(0, one), undefined)],
      ["wide 1인 0 → wide 보정만", same(t(0, one, "wide"), headTargetForShot("wide"))],
      ["2인 화자 없음 → 기본", same(t(undefined, two), undefined)],
      ["2인 2·-1·1.5·'1'·null → 기본", [2, -1, 1.5, "1", null].every((s) => same(t(s, two), undefined))],
      ["인물 정보 없음 → 기본", same(t(0, null), undefined)],
    ];
    const bad = cases.filter(([, ok]) => !ok).map(([nm]) => nm);
    if (bad.length === 0) {
      console.log(`ok   화자 목표점 — ${cases.length}가지 경우 모두 기대대로`);
    } else {
      failed++;
      console.error(`FAIL 화자 목표점 — ${bad.join(", ")}`);
    }
  }

  // #242 (가): 같은 top_right 말풍선에서 화자 0(왼쪽)의 꼬리가 화자 1(오른쪽)보다 더 왼쪽을 향하는지.
  {
    const left = resolveTail("top_right", "ellipse", 810, 150, 200, 60, 1000, 1000, { x: 0.3, y: 0.42 });
    const right = resolveTail("top_right", "ellipse", 810, 150, 200, 60, 1000, 1000, { x: 0.7, y: 0.42 });
    if (Math.cos(left.angle) < Math.cos(right.angle)) {
      console.log(`ok   화자 꼬리 방향 — 화자 0 ${(left.angle * 180 / Math.PI).toFixed(1)}° / 화자 1 ${(right.angle * 180 / Math.PI).toFixed(1)}° (0이 더 왼쪽)`);
    } else {
      failed++;
      console.error("FAIL 화자 꼬리 방향 — 화자 0이 더 왼쪽을 향하지 않음");
    }
  }

  // #242 (가): Export 경로(headTargetForCut → composeCut)에서 2인 컷 화자 0과 1의 그림이 서로 다르고,
  // 1인 컷에 남은 speaker_index는 그림을 바꾸지 않는지(화자 없는 1인 컷과 같은 그림).
  try {
    const base: Caption = { text: "둘 중 누가 말할까", bubble_type: "rounded", position: "bottom_left" };
    const draw = (c: Caption, frame: unknown[]) => composeCut(img, [c], [headTargetForCut({ caption: c, shot_type: "bust", characters_in_frame: frame })]);
    const [s0, s1, one0, one] = await Promise.all([
      draw({ ...base, speaker_index: 0 }, [{}, {}]), draw({ ...base, speaker_index: 1 }, [{}, {}]),
      draw({ ...base, speaker_index: 0 }, [{}]), draw(base, [{}]),
    ]);
    if (Buffer.compare(s0, s1) !== 0 && Buffer.compare(one0, one) === 0) {
      console.log("ok   화자 합성 — 2인 컷 화자 0·1 그림이 다르고, 1인 컷 speaker_index는 무시");
    } else {
      failed++;
      console.error("FAIL 화자 합성 — 2인 컷 화자별 차이 없음 또는 1인 컷에서 그림이 바뀜");
    }
  } catch (err) {
    failed++;
    console.error(`FAIL 화자 합성 — ${(err as Error).message}`);
  }

  // #259-8 D: bottom_* 말풍선은 화면 아래(0.70 근처)에 그려지고, 긴 대사도 캔버스 아래로
  // 나가지 않는다. 검은 1024 캔버스에 합성한 뒤 흰 픽셀(말풍선 몸통)이 있는 행 범위를 잰다.
  {
    const black = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    const whiteRows = async (caption: Caption) => {
      const { data, info } = await sharp(await composeCut(black, [caption])).raw().toBuffer({ resolveWithObject: true });
      const rows: number[] = [];
      for (let yy = 0; yy < info.height; yy++) {
        for (let xx = 0; xx < info.width; xx++) {
          const i = (yy * info.width + xx) * info.channels;
          if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) { rows.push(yy); break; }
        }
      }
      return { top: Math.min(...rows), bottom: Math.max(...rows), h: info.height };
    };
    const longText = "아침마다 무릎이 뻣뻣해서 계단을 내려갈 때마다 조심하게 되는데 퇴근 후 10분씩 스트레칭을 하면 정말 좀 나아질까 궁금해서 친구에게 물어봤어요";
    for (const bubble_type of ["rounded", "rect", "cloud"] as const) {
      const short = await whiteRows({ text: "무릎이 한결 가벼워졌어!", bubble_type, position: "bottom_left" });
      const long = await whiteRows({ text: longText, bubble_type, position: "bottom_right" });
      const ok = short.top >= short.h * 0.6 && long.bottom < long.h - 1;
      if (ok) {
        console.log(`ok   bottom ${bubble_type} — 짧은 대사 위끝 ${(short.top / short.h * 100).toFixed(0)}%, 긴 대사 아래끝 ${long.bottom}px(<${long.h - 1})`);
      } else {
        failed++;
        console.error(`FAIL bottom ${bubble_type} — 짧은 위끝 ${short.top}, 긴 아래끝 ${long.bottom}`);
      }
    }

    // 아래 경계 보정은 bottom 칸에만 — 캔버스를 넘칠 만큼 긴 대사여도 top·center 상자는
    // 원래 자리(POSITION_BOX y)에서 시작해야 한다. rect는 상자 위 끝이 곧 y라 바로 잴 수 있다.
    const huge = Array(15).fill(longText).join(" ");
    for (const [position, boxY] of [["top_left", 0.07], ["top_right", 0.07], ["center", 0.38]] as const) {
      const r = await whiteRows({ text: huge, bubble_type: "rect", position });
      if (Math.abs(r.top - boxY * r.h) <= 4) {
        console.log(`ok   ${position} 아주 긴 대사 — 아래 경계 보정 안 받음(위끝 ${r.top}px ≈ ${(boxY * r.h).toFixed(0)}px)`);
      } else {
        failed++;
        console.error(`FAIL ${position} 아주 긴 대사 — 위끝 ${r.top}px, 원래 자리 ${(boxY * r.h).toFixed(0)}px에서 움직임`);
      }
    }
  }

  // #242: 에디터에서 끌어 놓은 좌표(caption.anchor)를 Export가 쓴다 — 몸통 중심이 좌표에 오고, 폭은 0.44로
  // 고정, 가장자리여도 보정하지 않고, 잘못된 좌표는 무시(칸 이름 자리), 꼬리는 화자 쪽. 검은 1024 캔버스에서 잰다.
  {
    const black = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    const raw = async (caption: Caption, target?: HeadTarget) => {
      const { data, info } = await sharp(await composeCut(black, [caption], target ? [target] : undefined)).raw().toBuffer({ resolveWithObject: true });
      const white = (xx: number, yy: number) => { const i = (yy * info.width + xx) * info.channels; return data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200; };
      return { white, w: info.width, h: info.height };
    };
    const rowSpan = (r: Awaited<ReturnType<typeof raw>>, yy: number) => {
      let l = -1, rr = -1;
      for (let xx = 0; xx < r.w; xx++) if (r.white(xx, yy)) { if (l < 0) l = xx; rr = xx; }
      return { l, r: rr };
    };
    const colSpan = (r: Awaited<ReturnType<typeof raw>>, xx: number) => {
      let t = -1, b = -1;
      for (let yy = 0; yy < r.h; yy++) if (r.white(xx, yy)) { if (t < 0) t = yy; b = yy; }
      return { t, b };
    };
    const short = "무릎이 한결 가벼워졌어!";

    // ① 몸통 중심 = 좌표 (rect, 몸통 가운데 행의 흰 구간 중심 + 꼬리를 피한 세로줄의 위·아래 끝 중심)
    try {
      const bad: string[] = [];
      for (const [ax, ay] of [[0.5, 0.5], [0.3, 0.7], [0.68, 0.25]] as const) {
        const r = await raw({ text: short, bubble_type: "rect", position: "top_left", anchor: { x: ax, y: ay } });
        const row = rowSpan(r, Math.round(ay * r.h)), col = colSpan(r, Math.round(ax * r.w) + 150); // 꼬리를 피해 몸통 오른쪽 세로줄에서 잰다
        const cx = (row.l + row.r) / 2, cy = (col.t + col.b) / 2;
        if (Math.abs(cx - ax * r.w) > 6 || Math.abs(cy - ay * r.h) > 6) bad.push(`(${ax},${ay})→(${cx.toFixed(0)},${cy.toFixed(0)})`);
      }
      if (bad.length === 0) console.log("ok   anchor 위치 — 세 좌표 모두 몸통 중심이 좌표에 옴(±6px)");
      else { failed++; console.error(`FAIL anchor 위치 — ${bad.join(", ")}`); }
    } catch (err) { failed++; console.error(`FAIL anchor 위치 — ${(err as Error).message}`); }

    // ② 폭 0.44 고정 — center 칸의 아주 긴 대사도 폭을 넓히지 않는다(center 폭 넓히기는 좌표가 없을 때만)
    try {
      const longT = Array(6).fill("아침마다 무릎이 뻣뻣해서 계단을 내려갈 때마다 조심하게 돼요").join(" ");
      const r = await raw({ text: longT, bubble_type: "rect", position: "center", anchor: { x: 0.5, y: 0.5 } });
      const row = rowSpan(r, 512); const width = row.r - row.l + 1;
      if (Math.abs(width - 0.44 * r.w) <= 8) console.log(`ok   anchor 폭 — 긴 대사도 ${width}px(≈0.44×1024=${(0.44 * r.w).toFixed(0)})`);
      else { failed++; console.error(`FAIL anchor 폭 — ${width}px`); }
    } catch (err) { failed++; console.error(`FAIL anchor 폭 — ${(err as Error).message}`); }

    // ③ 가장자리여도 보정하지 않는다 — x 0.05면 몸통이 왼쪽 끝(0열)까지 걸친다
    try {
      const r = await raw({ text: short, bubble_type: "rect", position: "top_right", anchor: { x: 0.05, y: 0.5 } });
      if (r.white(0, 512)) console.log("ok   anchor 보정 없음 — 가장자리 좌표는 몸통이 화면 밖으로 걸친 채 그대로");
      else { failed++; console.error("FAIL anchor 보정 없음 — 왼쪽 끝으로 당겨짐"); }
    } catch (err) { failed++; console.error(`FAIL anchor 보정 없음 — ${(err as Error).message}`); }

    // ④ 잘못된 좌표는 무시 — 좌표 없는 것과 같은 그림
    try {
      const base: Caption = { text: short, bubble_type: "rounded", position: "bottom_left" };
      const ref = await composeCut(black, [base]);
      const bads = [{ x: 1.5, y: 0.5 }, { x: "0.5", y: 0.5 }, { x: NaN, y: 0.5 }, { x: 0.5 }, null, "center", { x: -0.1, y: 0.2 }];
      const diff: string[] = [];
      for (const a of bads) {
        const out = await composeCut(black, [{ ...base, anchor: a as unknown as Caption["anchor"] }]);
        if (Buffer.compare(ref, out) !== 0) diff.push(JSON.stringify(a));
      }
      if (diff.length === 0) console.log(`ok   anchor 잘못된 값 ${bads.length}가지 — 모두 무시하고 칸 이름 자리로 그림`);
      else { failed++; console.error(`FAIL anchor 잘못된 값이 그림을 바꿈 — ${diff.join(", ")}`); }
    } catch (err) { failed++; console.error(`FAIL anchor 잘못된 값 — ${(err as Error).message}`); }

    // ⑤ 꼬리는 화자 쪽 — 위쪽 가운데(0.5, 0.15)에 놓은 말풍선, 화자가 왼쪽(0.3)이면 몸통 아래 흰 픽셀이 왼쪽에 더 많다
    try {
      const cap: Caption = { text: short, bubble_type: "rounded", position: "top_left", anchor: { x: 0.5, y: 0.15 } };
      const side = async (tx: number) => {
        const r = await raw(cap, { x: tx, y: 0.42 }); let left = 0, right = 0;
        for (let yy = 215; yy < 340; yy++) for (let xx = 0; xx < r.w; xx++) if (r.white(xx, yy)) { if (xx < 512) left++; else right++; }
        return { left, right };
      };
      const L = await side(0.3), R = await side(0.7);
      if (L.left > L.right && R.right > R.left) console.log(`ok   anchor 꼬리 — 화자 왼쪽이면 왼쪽(${L.left}>${L.right}), 오른쪽이면 오른쪽(${R.right}>${R.left})`);
      else { failed++; console.error(`FAIL anchor 꼬리 — 왼쪽 화자 ${L.left}/${L.right}, 오른쪽 화자 ${R.left}/${R.right}`); }
    } catch (err) { failed++; console.error(`FAIL anchor 꼬리 — ${(err as Error).message}`); }
  }

  if (failed > 0) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log("\n35건 통과");
}

main();
