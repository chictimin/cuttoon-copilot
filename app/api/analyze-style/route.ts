import { NextRequest, NextResponse } from "next/server";
import { extractStyle } from "@/lib/openai/extract";
import { uploadAsset, validateUpload } from "@/lib/asset-store";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "분석할 이미지가 없습니다" }, { status: 400 });
    }

    for (const file of files) {
      const validationError = validateUpload(file);
      if (validationError) {
        return NextResponse.json({ error: validationError.message }, { status: 400 });
      }
    }

    const buffers = await Promise.all(
      files.map(async (file) => Buffer.from(await file.arrayBuffer()))
    );

    const [style, assetResults] = await Promise.all([
      extractStyle(buffers),
      Promise.all(
        buffers.map((buf, i) => uploadAsset(buf, files[i].name))
      ),
    ]);

    const styleRefAssets = assetResults.map((r) => r.assetUri);

    return NextResponse.json({
      style: { ...style, keywords: [] },
      styleRefAssets,
      characterSheetAsset: "asset://pending/character-sheet",
    });
  } catch (error) {
    console.error("스타일 분석 에러:", error);
    return NextResponse.json({ error: "스타일 분석 실패" }, { status: 500 });
  }
}
