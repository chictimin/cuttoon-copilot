import type { Preset } from "@/lib/llm/preset-guard";

export interface StyleAnalysisResult {
  characterSheetAsset: string;
  styleRefAssets: string[];
  style: Preset["style"];
}

export const CHARACTER_SHEET_PREVIEW = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#d4d4d8"/></svg>'
)}`;

/**
 * 레퍼런스 이미지 파일들로부터 스타일을 추출한다.
 * 현재는 mock 데이터를 반환한다.
 * 실제 구현(API 호출)은 B②가 extractStyle 개선과 함께 별도 PR로 진행 예정.
 */
export async function analyzeStyle(files: File[]): Promise<StyleAnalysisResult> {
  if (!files || files.length === 0) {
    throw new Error("분석할 이미지가 없습니다.");
  }

  // Mock 데이터 반환
  return {
    characterSheetAsset: "asset://stub/character-sheet",
    styleRefAssets: files.map((_, i) => `asset://ref-${i}`),
    style: {
      keywords: [],
      line_weight: "medium",
      saturation: "vivid",
      character_ratio: "2.5head",
      background_density: "low",
      bubble_style: "rounded",
      palette: ["#4A90E2", "#50C878", "#FFD700", "#FF6B6B"],
    },
  };
}
