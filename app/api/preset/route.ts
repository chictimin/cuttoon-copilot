import { assertValidPreset } from "@/lib/llm/preset-guard";
import { getPreset, savePreset } from "@/lib/db/presets";

export async function POST(request: Request) {
  const body = await request.json();

  try {
    assertValidPreset(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "프리셋 검증 실패" },
      { status: 400 }
    );
  }

  const saved = await savePreset(body);
  return Response.json({ presetId: saved.presetId, projectId: saved.projectId });
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 쿼리 필요" }, { status: 400 });

  const found = await getPreset(id);
  if (!found) return Response.json({ error: "없음" }, { status: 404 });

  return Response.json(found);
}
