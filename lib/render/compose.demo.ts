// captionSvg()의 POSITION_BOX 폴백(#70)이 실제로 크래시를 막는지, 그리고 폴백된
// 값이 box·shape·tail 전부에 일관되게 쓰이는지(#79) 확인하는 스크립트.
// storyboard.schema.json enum 밖의 값은 저장 시점 검증을 뚫고 들어올 수 있으므로
// (app/api/session/validate.ts, #70/#79 이슈 참고) 타입을 `as Position`으로 우회해 재현한다.
// #199: center 꼬리가 화자 방향을 향하는지, 기본 목표점(몸통 안)에서는 예전 고정 꼬리 그대로인지도 본다.
//
// 실행: npx tsx lib/render/compose.demo.ts

import sharp from "sharp";
import { composeCut, headTargetForShot, resolveTail, type HeadTarget } from "./compose";
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

  if (failed > 0) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log("\n18건 통과");
}

main();
