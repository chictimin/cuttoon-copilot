// README "구현 현황" 13번(Export ZIP) — storyboard의 cuts를 받아 각 컷에 대사를
// 구워 넣고 ZIP으로 묶는다. 이미지가 아직 생성 안 된 컷(generated_image=null, 지금은
// 이미지 생성이 스텁이라 실제로 흔함)은 건너뛰고 skipped에 cut_index를 남긴다 —
// 조용히 빠뜨리지 않기 위함.

import { readAsset } from "../asset-store";
import { composeCut, headTargetForCut } from "./compose";
import { isDemoCacheRef, readDemoCacheImage } from "./demo-cache";
import { loadFont, type PresetFont } from "./font";
import { buildZip } from "./zip";
import type { Cut } from "./types";

export interface ExportResult {
  zip: Buffer;
  included: number[];
  skipped: number[];
}

// font: 프리셋의 프로젝트 웹폰트(#209). 없거나 받지 못하면 시스템 폰트로 그리고 Export는 계속된다.
// demoCachePublicDir: 데모 캐시를 읽을 public 폴더(#240). demo만 임시 폴더를 넘기고 실제 호출은 생략한다.
export async function exportCuts(
  cuts: Cut[],
  opts: { font?: PresetFont | null; demoCachePublicDir?: string } = {}
): Promise<ExportResult> {
  const font = await loadFont(opts.font);
  const sorted = [...cuts].sort((a, b) => a.cut_index - b.cut_index);
  const entries: { name: string; data: Buffer }[] = [];
  const included: number[] = [];
  const skipped: number[] = [];

  for (const cut of sorted) {
    if (!cut.generated_image) {
      skipped.push(cut.cut_index);
      continue;
    }
    // #240: 데모 캐시 세션은 public 경로를 저장한다 — manifest에 있는 값만 로컬에서 읽는다.
    const imageBuffer = isDemoCacheRef(cut.generated_image)
      ? await readDemoCacheImage(cut.generated_image, opts.demoCachePublicDir)
      : await readAsset(cut.generated_image);
    if (!imageBuffer) {
      skipped.push(cut.cut_index);
      continue;
    }
    // #242: 2인 컷은 화자 쪽(가로 30%/70%), wide 컷은 꼬리 목표점을 아래로. 그 밖에는 기본 목표점.
    const composed = await composeCut(imageBuffer, [cut.caption], [headTargetForCut(cut)], font);
    entries.push({ name: `cut_${cut.cut_index}.png`, data: composed });
    included.push(cut.cut_index);
  }

  const zip = await buildZip(entries);
  return { zip, included, skipped };
}
