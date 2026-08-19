// captionSvg()의 POSITION_BOX 폴백(#70)이 실제로 크래시를 막는지 확인하는 스크립트.
// storyboard.schema.json enum 밖의 값은 저장 시점 검증을 뚫고 들어올 수 있으므로
// (app/api/session/validate.ts, #70 이슈 참고) 타입을 `as Position`으로 우회해 재현한다.
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

  if (failed > 0) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log("\n2건 통과");
}

main();
