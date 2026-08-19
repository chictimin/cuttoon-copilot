import { uploadAsset } from "@/lib/asset-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return Response.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    const uploadResults = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return uploadAsset(buffer, file.name);
      })
    );

    return Response.json({
      assets: uploadResults,
      count: uploadResults.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "업로드 실패";
    return Response.json({ error: message }, { status: 500 });
  }
}
