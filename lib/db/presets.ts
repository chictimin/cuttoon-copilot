import "server-only";

import type { Preset } from "@/lib/llm/preset-guard";
import { getDb } from "./client";

export interface SavedPreset {
  presetId: string;
  projectId: string;
  preset: Preset;
}

/**
 * 프로젝트 행을 만들고 그 아래 프리셋을 저장한다.
 * project_name의 정본은 projects.name이고(issue #7), preset JSON 안의 값은
 * 읽을 때 이 컬럼으로 덮어써서 내려보낸다.
 */
export async function savePreset(preset: Preset): Promise<SavedPreset> {
  const { data: project, error: projectError } = await getDb()
    .from("projects")
    .insert({ name: preset.project_name })
    .select("id")
    .single();

  if (projectError) throw new Error(`프로젝트 저장 실패: ${projectError.message}`);

  const { data: row, error: presetError } = await getDb()
    .from("presets")
    .insert({
      project_id: project.id,
      version: preset.preset_version,
      data: preset,
    })
    .select("id")
    .single();

  if (presetError) {
    // Supabase JS에는 트랜잭션이 없다. 프리셋 저장이 실패하면 방금 만든 프로젝트
    // 행이 프리셋 없는 고아로 남으므로 되돌린다. 이 삭제까지 실패하면 고아가
    // 남지만, 그때는 원래 에러를 덮지 않고 로그로만 남긴다.
    const { error: rollbackError } = await getDb()
      .from("projects")
      .delete()
      .eq("id", project.id);
    if (rollbackError) {
      console.error(
        `[savePreset] 프로젝트 롤백 실패 (고아 행 ${project.id}):`,
        rollbackError.message
      );
    }
    throw new Error(`프리셋 저장 실패: ${presetError.message}`);
  }

  return { presetId: row.id, projectId: project.id, preset };
}

/** 프리셋 하나를 읽는다. project_name은 projects.name으로 채워서 돌려준다. */
export async function getPreset(presetId: string): Promise<SavedPreset | null> {
  const { data, error } = await getDb()
    .from("presets")
    .select("id, project_id, data, projects(name)")
    .eq("id", presetId)
    .maybeSingle();

  if (error) throw new Error(`프리셋 조회 실패: ${error.message}`);
  if (!data) return null;

  const joined = data.projects as unknown as { name: string } | null;
  const preset = data.data as Preset;

  return {
    presetId: data.id,
    projectId: data.project_id,
    preset: joined ? { ...preset, project_name: joined.name } : preset,
  };
}

export interface ProjectSummary {
  projectId: string;
  projectName: string;
  presetId: string | null;
  presetVersion: string | null;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 프로젝트 목록. 목록 화면이 jsonb를 파싱하지 않아도 되도록 요약만 내려준다
 * (issue #7에서 projects.name을 정본으로 둔 이유와 같다).
 *
 * 프리셋 문서 본문은 넣지 않는다 — 목록에 필요 없고, 프로젝트가 늘어나면 응답이
 * 그만큼 커진다. 상세가 필요하면 GET /api/preset?id= 로 따로 읽는다.
 *
 * 스키마상 프로젝트 하나에 프리셋이 여러 개 달릴 수 있지만(presets.project_id),
 * savePreset은 프로젝트당 하나만 만든다. 나중에 프리셋을 갱신하는 경로가 생기면
 * 여러 개가 될 수 있으므로 가장 최근 것 하나를 고른다.
 */
export async function listProjects(): Promise<ProjectSummary[]> {
  const { data, error } = await getDb()
    .from("projects")
    .select("id, name, created_at, updated_at, presets(id, version, created_at), sessions(count)")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`프로젝트 목록 조회 실패: ${error.message}`);
  if (!data) return [];

  return data.map((row) => {
    const presets = (row.presets ?? []) as Array<{
      id: string;
      version: string;
      created_at: string;
    }>;
    // created_at 내림차순으로 골라 가장 최근 프리셋을 쓴다.
    const latest = presets
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    // sessions(count)는 [{ count: n }] 형태로 온다. 세션이 없으면 빈 배열이다.
    const counts = (row.sessions ?? []) as Array<{ count: number }>;

    return {
      projectId: row.id,
      projectName: row.name,
      presetId: latest?.id ?? null,
      presetVersion: latest?.version ?? null,
      sessionCount: counts[0]?.count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
