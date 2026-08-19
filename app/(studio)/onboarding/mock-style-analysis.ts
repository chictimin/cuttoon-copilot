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
 * FileList를 받아서 /api/analyze-upload로 전송하고 결과를 반환한다.
 */
export async function analyzeStyle(files: File[]): Promise<StyleAnalysisResult> {
  if (!files || files.length === 0) {
    throw new Error("분석할 이미지가 없습니다.");
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch("/api/analyze-upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? "스타일 분석 실패");
  }

  return response.json();
}
