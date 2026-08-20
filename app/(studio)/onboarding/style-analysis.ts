import type { Preset } from "@/lib/llm/preset-guard";

export interface StyleAnalysisResult {
  styleRefAssets: string[];
  style: Preset["style"];
}

async function uploadReference(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "업로드에 실패했습니다");
  }
  const { assetUri } = (await res.json()) as { assetUri: string };
  return assetUri;
}

/**
 * issue #3: 레퍼런스 이미지 파일들을 업로드하고(/api/upload) asset:// 참조로
 * 바꾼 뒤, 그 참조로 스타일을 추출한다(/api/extract → lib/openai/extract.ts,
 * 실제 gpt-4o 호출). 캐릭터 시트 자체는 여기서 만들지 않는다 — context(업종
 * 등)가 아직 없어서(DetailsStep에서 수집) OnboardingFlow.handleConfirmDetails가
 * context까지 모인 뒤 생성한다.
 */
export async function analyzeStyle(files: File[]): Promise<StyleAnalysisResult> {
  if (!files || files.length === 0) {
    throw new Error("분석할 이미지가 없습니다.");
  }

  const styleRefAssets = await Promise.all(files.map(uploadReference));

  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetUris: styleRefAssets }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "스타일 분석에 실패했습니다");
  }
  const { style } = (await res.json()) as { style: Omit<Preset["style"], "keywords"> };

  return {
    styleRefAssets,
    // style.keywords는 온보딩에서 따로 안 모은다(자유 키워드 입력 단계 없음) — 빈 배열.
    style: { ...style, keywords: [] },
  };
}
