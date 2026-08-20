import { NextRequest, NextResponse } from "next/server";
import {
  uploadAsset,
  validateUpload,
  validateFileContent,
  type AllowedUploadMimeType,
} from "@/lib/asset-store";

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

    // #78: file.type은 클라이언트 선언값이라 확장자·타입을 속일 수 있다 —
    // 실제 바이트가 선언한 형식과 맞는지 업로드 직전에 한 번 더 확인한다.
    const declaredType = file.type as AllowedUploadMimeType;
    const contentError = validateFileContent(buffer, declaredType);
    if (contentError) {
      return NextResponse.json({ error: contentError.message }, { status: 400 });
    }

    const result = await uploadAsset(buffer, declaredType, file.name);

    return NextResponse.json({
      assetUri: result.assetUri,
      originalName: result.originalName,
    });
  } catch (error) {
    console.error("업로드 에러:", error);
    return NextResponse.json({ error: "업로드 실패" }, { status: 500 });
  }
}
