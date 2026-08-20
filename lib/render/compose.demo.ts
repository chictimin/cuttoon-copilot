// captionSvg()의 POSITION_BOX 폴백(#70)이 실제로 크래시를 막는지, 그리고 폴백된
// 값이 box·shape·tail 전부에 일관되게 쓰이는지(#79) 확인하는 스크립트.
// storyboard.schema.json enum 밖의 값은 저장 시점 검증을 뚫고 들어올 수 있으므로
// (app/api/session/validate.ts, #70/#79 이슈 참고) 타입을 `as Position`으로 우회해 재현한다.
//
// 실행: npx tsx lib/render/compose.demo.ts

import sharp from "sharp";
import { composeCut } from "./compose";
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

  if (failed > 0) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log("\n3건 통과");
}

main();
