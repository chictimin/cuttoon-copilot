// storyboard.schema.json이 나오기 전, "그리는 방법" 자체가 실제로 되는지 확인하는
// 1회성 검증 스크립트. 진짜 컷 이미지 대신 가짜(단색) 이미지를 쓴다.
//
// 실행: npx tsx lib/render/demo.ts

import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { composeCut } from "./compose";
import { buildZip } from "./zip";
import type { CaptionInput } from "./types";

const OUT_DIR = ".demo-output";
const SIZE = 1080;

async function fakeCut(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const cuts: { color: { r: number; g: number; b: number }; captions: CaptionInput[] }[] = [
    {
      color: { r: 235, g: 210, b: 180 },
      captions: [
        { text: "첫 출근 날 아침이다.", bubbleType: "rounded", position: "top_left" },
        { text: "심장이 터질 것 같아 정말로 긴장된다.", bubbleType: "rounded", position: "bottom_right" },
      ],
    },
    {
      color: { r: 200, g: 220, b: 235 },
      captions: [
        { text: "괜찮을 거야, 분명.", bubbleType: "cloud", position: "top_right" },
        { text: "직각 말풍선 테스트용 대사입니다.", bubbleType: "rect", position: "bottom_left" },
      ],
    },
  ];

  const zipEntries = [];
  for (let i = 0; i < cuts.length; i++) {
    const { color, captions } = cuts[i];
    const raw = await fakeCut(color);
    const composed = await composeCut(raw, captions);
    const name = `cut_${i + 1}.png`;
    await writeFile(`${OUT_DIR}/${name}`, composed);
    zipEntries.push({ name, data: composed });
    console.log(`  컷 ${i + 1} 합성 완료 -> ${OUT_DIR}/${name}`);
  }

  const zip = await buildZip(zipEntries);
  await writeFile(`${OUT_DIR}/cuttoon.zip`, zip);
  console.log(`  ZIP 생성 완료 -> ${OUT_DIR}/cuttoon.zip`);
  console.log("\n검증 완료 — PNG 파일을 열어서 말풍선이 제대로 그려졌는지 눈으로 확인할 것.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
