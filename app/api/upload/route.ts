import { NextRequest, NextResponse } from "next/server";
import { uploadAsset, validateUpload } from "@/lib/asset-store";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    const validationError = validateUpload(file);
    if (validationError) {
      return NextResponse.json({ error: validationError.message }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadAsset(buffer, file.name);

    return NextResponse.json({
      assetUri: result.assetUri,
      originalName: result.originalName,
    });
  } catch (error) {
    console.error("업로드 에러:", error);
    return NextResponse.json({ error: "업로드 실패" }, { status: 500 });
  }
}
