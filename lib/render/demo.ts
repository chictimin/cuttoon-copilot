// spec/storyboard.schema.json이 확정된 뒤(2026-08-19), 실제 샘플 storyboard로
// Export 전체 경로(readAsset -> composeCut -> ZIP)를 검증하는 스크립트.
//
// 실행: npx tsx lib/render/demo.ts
//
// spec/samples/storyboard.knee-cartilage.sample.json은 cut1만 generated_image가
// 있고 나머지 3컷은 null이다(이미지 생성이 아직 스텁이라 실제로 흔한 상태) —
// exportCuts가 그 3컷을 조용히 빠뜨리지 않고 skipped로 알려주는지도 같이 확인한다.
// cut1의 asset://이 실제 Supabase Storage에 없을 수도 있다 — 그 경우 가짜 이미지로
// 대체해서 "그리는 로직" 자체는 계속 검증한다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { composeCut } from "./compose";
import { exportCuts } from "./export";
import type { Cut } from "./types";

const OUT_DIR = ".demo-output";
const SAMPLE_PATH = "spec/samples/storyboard.knee-cartilage.sample.json";

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const raw = await readFile(SAMPLE_PATH, "utf-8");
  const storyboard = JSON.parse(raw) as { cuts: Cut[] };

  console.log(`샘플 storyboard 로드: "${(JSON.parse(raw) as { subject: string }).subject}" (컷 ${storyboard.cuts.length}개)`);

  const { zip, included, skipped } = await exportCuts(storyboard.cuts);
  console.log(`  실제 export 시도 -> 포함: ${included.join(", ") || "없음"} / 건너뜀: ${skipped.join(", ") || "없음"}`);

  if (zip.length > 0) {
    await writeFile(`${OUT_DIR}/storyboard.zip`, zip);
    console.log(`  ZIP 생성 완료 -> ${OUT_DIR}/storyboard.zip (실제 asset 있는 컷만 포함됨)`);
  } else {
    console.log("  실제 asset이 하나도 없어서(Supabase에 아직 안 올라감) ZIP은 비어있음 — 아래에서 가짜 이미지로 대체 검증");
  }

  // 실제 Storage에 이미지가 아직 없을 수 있으니, 가짜 이미지로 4컷 전부 강제 검증한다.
  console.log("\n가짜 이미지로 4컷 전부 강제 검증...");
  for (const cut of storyboard.cuts) {
    const fake = await sharp({
      create: { width: 1080, height: 1080, channels: 3, background: { r: 230, g: 225, b: 215 } },
    }).png().toBuffer();
    const composed = await composeCut(fake, [cut.caption]);
    const name = `cut_${cut.cut_index}_fake.png`;
    await writeFile(`${OUT_DIR}/${name}`, composed);
    console.log(`  컷 ${cut.cut_index} (${cut.caption.bubble_type}/${cut.caption.position}) -> ${OUT_DIR}/${name}`);
  }

  console.log("\n검증 완료 — PNG 파일을 열어서 확인할 것.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
