import { uploadAsset, readAsset } from "@/lib/asset-store";
import { extractStyle } from "@/lib/openai/extract";
import type { StyleAnalysisResult } from "@/app/(studio)/onboarding/mock-style-analysis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return Response.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    // 1. 파일 업로드
    const uploadResults = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return uploadAsset(buffer, file.name);
      })
    );

    // 2. 업로드된 파일들 다시 읽기 (OpenAI 분석용)
    const buffers = await Promise.all(
      uploadResults.map(async (result) => {
        const buffer = await readAsset(result.assetUri);
        if (!buffer) throw new Error(`${result.assetUri}를 읽을 수 없습니다`);
        return buffer;
      })
    );

    // 3. 스타일 추출
    const styleExtraction = await extractStyle(buffers);

    // 4. 캐릭터 시트 asset (일단 mock)
    const characterSheetAsset = `asset://character-sheet-${crypto.randomUUID()}`;

    const result: StyleAnalysisResult = {
      characterSheetAsset,
      styleRefAssets: uploadResults.map((r) => r.assetUri),
      style: {
        keywords: [],
        ...styleExtraction,
      },
    };

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "분석 실패";
    console.error("분석 에러:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
