// README "구현 현황" 13번(Export ZIP) — storyboard의 cuts를 받아 각 컷에 대사를
// 구워 넣고 ZIP으로 묶는다. 이미지가 아직 생성 안 된 컷(generated_image=null, 지금은
// 이미지 생성이 스텁이라 실제로 흔함)은 건너뛰고 skipped에 cut_index를 남긴다 —
// 조용히 빠뜨리지 않기 위함.

import { readAsset } from "../asset-store";
import { composeCut } from "./compose";
import { buildZip } from "./zip";
import type { Cut } from "./types";

export interface ExportResult {
  zip: Buffer;
  included: number[];
  skipped: number[];
}

export async function exportCuts(cuts: Cut[]): Promise<ExportResult> {
  const sorted = [...cuts].sort((a, b) => a.cut_index - b.cut_index);
  const entries: { name: string; data: Buffer }[] = [];
  const included: number[] = [];
  const skipped: number[] = [];

  for (const cut of sorted) {
    if (!cut.generated_image) {
      skipped.push(cut.cut_index);
      continue;
    }
    const imageBuffer = await readAsset(cut.generated_image);
    if (!imageBuffer) {
      skipped.push(cut.cut_index);
      continue;
    }
    const composed = await composeCut(imageBuffer, [cut.caption]);
    entries.push({ name: `cut_${cut.cut_index}.png`, data: composed });
    included.push(cut.cut_index);
  }

  const zip = await buildZip(entries);
  return { zip, included, skipped };
}
