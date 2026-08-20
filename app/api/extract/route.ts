import { extractStyle } from "@/lib/openai/extract";
import { readAsset } from "@/lib/asset-store";

// POST /api/extract
// body: { assetUris: string[] } — /api/upload로 이미 올라간 레퍼런스 이미지들의 asset://.
// 파일을 다시 받지 않고 asset-store에서 읽는다 — 업로드는 한 곳(/api/upload)에서만 한다.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "본문은 객체여야 합니다" }, { status: 400 });
  }
  const { assetUris } = body as Record<string, unknown>;

  if (!Array.isArray(assetUris) || assetUris.length === 0 || !assetUris.every((u) => typeof u === "string")) {
    return Response.json({ error: "assetUris는 asset:// 문자열 배열(1개 이상)이어야 합니다" }, { status: 400 });
  }

  try {
    const buffers: Buffer[] = [];
    for (const uri of assetUris) {
      const buf = await readAsset(uri);
      if (!buf) {
        return Response.json({ error: `자산을 찾을 수 없습니다: ${uri}` }, { status: 400 });
      }
      buffers.push(buf);
    }

    const style = await extractStyle(buffers);
    return Response.json({ style });
  } catch (e) {
    // extract.ts:19 참고 — 원문 에러엔 요청 파라미터가 안 섞이지만, 그래도 관례를
    // 맞춰 로그로만 남긴다.
    console.error("[POST /api/extract] 스타일 추출 실패:", e);
    return Response.json({ error: "스타일 추출에 실패했습니다" }, { status: 500 });
  }
}
