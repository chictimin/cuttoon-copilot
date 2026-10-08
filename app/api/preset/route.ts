import { assertValidPreset, dedupePresetArrays, type Preset } from "@/lib/llm/preset-guard";
import {
  archiveProject,
  getPreset,
  listProjects,
  renameProject,
  savePreset,
  updatePresetData,
} from "@/lib/db/presets";

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

  // R1-a (K2): 저장 직전에 중복만 지우고 저장한다(400 거부 아님).
  // 공개: 프리셋 저장 시 배열의 중복 값은 첫 등장만 남기고 지운다 —
  // 저장 값이 보낸 값과 다를 수 있다(중복만). 응답 형태는 그대로(제거 정보 필드 없음).
  const deduped = dedupePresetArrays(body as Preset);
  if (deduped.removed.length > 0) {
    console.warn(
      `[preset] 중복 제거 ${deduped.removed.map((r) => `${r.path}:${r.count}`).join(", ")}`
    );
  }

  // CTA 강도 기본값 (issue #205): 생성 시에만 기록한다. 화면이 값을 보내지
  // 않으면 "soft"를 기록하고, 읽을 때 필드가 없으면 "clear"로 해석한다
  // (기존 프로젝트 회귀 없음). PATCH·기존 데이터는 건드리지 않는다.
  const preset = deduped.preset as Preset;
  if (preset.rules.cta_strength === undefined) {
    preset.rules.cta_strength = "soft";
  }

  // DB 실패는 요청 내용의 문제가 아니므로 400과 구분한다. 원문 메시지는
  // 내부 정보(테이블명·제약조건)를 담으므로 응답에 넣지 않고 로그로만 남긴다.
  try {
    const saved = await savePreset(preset);
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

/**
 * 프로젝트 이름 변경 + mascot 갱신 (issue #150 C7).
 * body: { projectId, name } (이름 변경, 현행 그대로)
 *     | { id, mascot } (mascot 갱신. mascot: null이면 제거)
 * - mascot은 저장된 프리셋에 합친 결과를 assertValidPreset으로 검증한 뒤 저장한다.
 * - 두 키가 함께 오면 둘 다 수행한다.
 */
export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  const { projectId, name, id, mascot } = (body ?? {}) as Record<string, unknown>;
  const wantsMascot = "mascot" in (body as Record<string, unknown>) || "id" in (body as Record<string, unknown>);
  const wantsRename = name !== undefined || (projectId !== undefined && !wantsMascot);

  if (!wantsRename && !wantsMascot) {
    return Response.json({ error: "projectId · name(빈 문자열 불가)이 필요합니다" }, { status: 400 });
  }

  const result: Record<string, unknown> = {};

  if (wantsRename) {
    if (typeof projectId !== "string" || typeof name !== "string" || name.length === 0) {
      return Response.json({ error: "projectId · name(빈 문자열 불가)이 필요합니다" }, { status: 400 });
    }

    try {
      await renameProject(projectId, name);
      result.projectId = projectId;
      result.name = name;
    } catch (e) {
      const message = e instanceof Error ? e.message : "프로젝트 이름 변경 실패";
      console.error("[PATCH /api/preset] 이름 변경 실패:", e);
      return Response.json(
        { error: message },
        { status: message.includes("존재하지 않는") ? 404 : 500 }
      );
    }
  }

  if (wantsMascot) {
    if (typeof id !== "string" || id.length === 0) {
      return Response.json({ error: "프리셋 id가 필요합니다" }, { status: 400 });
    }
    if (mascot !== null && (typeof mascot !== "object" || mascot === null)) {
      return Response.json({ error: "mascot은 객체 또는 null이어야 합니다" }, { status: 400 });
    }

    let saved;
    try {
      saved = await getPreset(id);
    } catch (e) {
      console.error("[PATCH /api/preset] mascot 갱신용 프리셋 조회 실패:", e);
      return Response.json({ error: "프리셋 조회에 실패했습니다" }, { status: 500 });
    }
    if (!saved) return Response.json({ error: "없음" }, { status: 404 });

    const merged = { ...saved.preset };
    if (mascot === null) {
      delete merged.mascot;
    } else {
      merged.mascot = mascot as { label: string; description: string };
    }
    try {
      assertValidPreset(merged);
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "프리셋 검증 실패" },
        { status: 400 }
      );
    }

    // R1-a (K2): PATCH 병합 결과가 중복을 만들면 저장 직전에 지운다(공개 문구는 POST와 같음).
    const dedupedMerged = dedupePresetArrays(merged);
    if (dedupedMerged.removed.length > 0) {
      console.warn(
        `[preset] 중복 제거 ${dedupedMerged.removed.map((r) => `${r.path}:${r.count}`).join(", ")}`
      );
    }
    const deduped = dedupedMerged.preset as Preset & { mascot?: unknown };

    try {
      await updatePresetData(id, deduped);
    } catch (e) {
      const message = e instanceof Error ? e.message : "프리셋 갱신 실패";
      console.error("[PATCH /api/preset] mascot 갱신 실패:", e);
      return Response.json(
        { error: message },
        { status: message.includes("존재하지 않는") ? 404 : 500 }
      );
    }
    result.presetId = id;
    result.mascot = deduped.mascot ?? null;
  }

  return Response.json(result);
}

/**
 * 프로젝트를 목록에서 비활성화한다(하드 삭제 아님, issue #161). 쿼리: ?projectId=
 * 세션·컷 데이터는 그대로 남고 listProjects()에서만 빠진다.
 */
export async function DELETE(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");

  if (!projectId) {
    return Response.json({ error: "projectId가 필요합니다" }, { status: 400 });
  }

  try {
    await archiveProject(projectId);
    return Response.json({ projectId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "프로젝트 비활성화 실패";
    console.error("[DELETE /api/preset] 비활성화 실패:", e);
    return Response.json(
      { error: message },
      { status: message.includes("존재하지 않는") ? 404 : 500 }
    );
  }
}
