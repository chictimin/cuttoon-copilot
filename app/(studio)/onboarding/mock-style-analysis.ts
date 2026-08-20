import type { Preset } from "@/lib/llm/preset-guard";

export interface StyleAnalysisResult {
  characterSheetAsset: string;
  styleRefAssets: string[];
  style: Preset["style"];
}

export const CHARACTER_SHEET_PREVIEW = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#d4d4d8"/></svg>'
)}`;

export async function analyzeStyle(files: File[]): Promise<StyleAnalysisResult> {
  if (!files || files.length === 0) {
    throw new Error("분석할 이미지가 없습니다.");
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch("/api/analyze-style", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "스타일 분석 실패");
  }

  return response.json() as Promise<StyleAnalysisResult>;
}
