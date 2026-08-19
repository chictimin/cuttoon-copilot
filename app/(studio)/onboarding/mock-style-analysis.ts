// 온보딩(A②) 임시 스타일 분석 mock. 레퍼런스 추출은 B②(lib/openai/extract.ts) 소관이지만
// 아직 없어서, preset.schema.json의 style.* 형태를 그대로 흉내낸 mock을 내 폴더 안에 둔다
// (담당 아닌 폴더에 임시 파일을 만들지 않는다 — 팀 브랜치 규약). 실제 연동 시 이 시그니처를
// 유지한 채 내부 구현만 교체한다.

import type { Preset } from "@/lib/llm/preset-guard";

export interface StyleAnalysisResult {
  characterSheetAsset: string;
  styleRefAssets: string[];
  style: Preset["style"];
}

export const CHARACTER_SHEET_PREVIEW = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#d4d4d8"/></svg>'
)}`;

const MOCK_ANALYSIS_DELAY_MS = 1500;

// TODO(B②): 실제 레퍼런스 추출/스타일 분석 호출로 교체.
export async function analyzeStyle(referenceCount: number): Promise<StyleAnalysisResult> {
  if (referenceCount <= 0) {
    throw new Error("레퍼런스 이미지가 없습니다.");
  }

  await new Promise((resolve) => setTimeout(resolve, MOCK_ANALYSIS_DELAY_MS));

  return {
    characterSheetAsset: `asset://mock/character-sheet-${crypto.randomUUID()}`,
    styleRefAssets: Array.from({ length: referenceCount }, (_, i) => `asset://mock/style-ref-${i}`),
    style: {
      keywords: [],
      line_weight: "medium",
      palette: ["#F4A261", "#2A9D8F", "#264653", "#E9C46A"],
      saturation: "vivid",
      character_ratio: "2.5head",
      background_density: "low",
      bubble_style: "rounded",
    },
  };
}
