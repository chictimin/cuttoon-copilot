// 온보딩(A②) 임시 연동 계약. 실제 Gemini 스타일 분석 API가 확정되면
// 이 시그니처를 유지한 채 내부 구현만 교체한다.

export interface StyleAnalysisResult {
  characterSheet: string; // 캐릭터 시트 이미지 URL
  colorPalette: string; // 색감 팔레트 이미지 URL
  backgroundTone: string; // 배경 톤 이미지 URL
}

const GRAY_1024_PLACEHOLDER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#d4d4d8"/></svg>'
)}`;

const MOCK_ANALYSIS_DELAY_MS = 1500;

// TODO(B①): 실제 Gemini(나노바나나) 스타일 분석 호출로 교체.
export async function analyzeStyle(
  referenceImages: string[]
): Promise<StyleAnalysisResult> {
  if (referenceImages.length === 0) {
    throw new Error("레퍼런스 이미지가 없습니다.");
  }

  await new Promise((resolve) => setTimeout(resolve, MOCK_ANALYSIS_DELAY_MS));

  return {
    characterSheet: GRAY_1024_PLACEHOLDER,
    colorPalette: GRAY_1024_PLACEHOLDER,
    backgroundTone: GRAY_1024_PLACEHOLDER,
  };
}
