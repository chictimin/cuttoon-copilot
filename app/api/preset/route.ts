import { assertValidPreset } from "@/lib/llm/preset-guard";
import { getPreset, listProjects, savePreset } from "@/lib/db/presets";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  try {
    assertValidPreset(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "프리셋 검증 실패" },
      { status: 400 }
    );
  }

  // DB 실패는 요청 내용의 문제가 아니므로 400과 구분한다. 원문 메시지는
  // 내부 정보(테이블명·제약조건)를 담으므로 응답에 넣지 않고 로그로만 남긴다.
  try {
    const saved = await savePreset(body);
    return Response.json({ presetId: saved.presetId, projectId: saved.projectId });
  } catch (e) {
    console.error("[POST /api/preset] 저장 실패:", e);
    return Response.json({ error: "프리셋 저장에 실패했습니다" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  // id가 없으면 프로젝트 목록을 준다. 목록 화면이 쓰는 경로이고, 프로젝트 하나에
  // 프리셋 하나가 붙는 구조라 별도 라우트를 두지 않았다.
  if (!id) {
    try {
      return Response.json({ projects: await listProjects() });
    } catch (e) {
      console.error("[GET /api/preset] 목록 조회 실패:", e);
      return Response.json({ error: "프로젝트 목록 조회에 실패했습니다" }, { status: 500 });
    }
  }

  try {
    const found = await getPreset(id);
    if (!found) return Response.json({ error: "없음" }, { status: 404 });
    return Response.json(found);
  } catch (e) {
    console.error("[GET /api/preset] 조회 실패:", e);
    return Response.json({ error: "프리셋 조회에 실패했습니다" }, { status: 500 });
  }
}
