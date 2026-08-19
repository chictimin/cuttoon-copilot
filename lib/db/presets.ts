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
