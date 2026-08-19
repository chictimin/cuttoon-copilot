import "server-only";

import type { StoryboardCut } from "@/lib/llm/storyboard-guard";
import { getDb } from "./client";

/**
 * storyboard.schema.json의 최상위 required 네 개만 타입으로 잡는다.
 * 전체 구조를 재현하지 않는 이유는 스키마 소유권이 A①이고(PRD.md 5절), 이 계층은
 * 문서를 통째로 jsonb에 넣고 꺼내기만 하기 때문이다. lib/llm/에 정식 Storyboard
 * 타입이 나오면 이 선언을 지우고 그쪽을 import한다.
 */
export interface Storyboard {
  storyboard_version: string;
  subject: string;
  cast: unknown[];
  cuts: StoryboardCut[];
}

export interface SavedSession {
  sessionId: string;
  projectId: string;
  presetId: string;
  version: number;
  storyboard: Storyboard;
}

/** session_versions에서 꺼낸 storyboard의 subject를 sessions.subject로 덮어쓴다. */
function withCanonicalSubject(storyboard: Storyboard, subject: string): Storyboard {
  return { ...storyboard, subject };
}

/**
 * 세션을 만들고 첫 버전(v1)을 함께 저장한다.
 *
 * subject의 정본은 sessions.subject 컬럼이다 — projects.name이 project_name의
 * 정본인 것과 같은 이유다(issue #7). storyboard JSON 안의 subject는 읽을 때 컬럼
 * 값으로 덮어써서 내려보내므로, 소재를 고칠 때 jsonb를 다시 쓰지 않아도 된다.
 */
export async function createSession(params: {
  projectId: string;
  presetId: string;
  storyboard: Storyboard;
}): Promise<SavedSession> {
  const { projectId, presetId, storyboard } = params;

  const { data: session, error: sessionError } = await getDb()
    .from("sessions")
    .insert({
      project_id: projectId,
      preset_id: presetId,
      subject: storyboard.subject,
    })
    .select("id")
    .single();

  if (sessionError) throw new Error(`세션 저장 실패: ${sessionError.message}`);

  const { error: versionError } = await getDb()
    .from("session_versions")
    .insert({ session_id: session.id, version: 1, storyboard });

  if (versionError) {
    // presets.ts와 같은 처리다. Supabase JS에 트랜잭션이 없어서, 버전 저장이
    // 실패하면 스토리보드 없는 빈 세션이 남으므로 되돌린다. 롤백까지 실패하면
    // 원래 에러를 덮지 않고 로그로만 남긴다.
    const { error: rollbackError } = await getDb()
      .from("sessions")
      .delete()
      .eq("id", session.id);
    if (rollbackError) {
      console.error(
        `[createSession] 세션 롤백 실패 (고아 행 ${session.id}):`,
        rollbackError.message
      );
    }
    throw new Error(`스토리보드 저장 실패: ${versionError.message}`);
  }

  return {
    sessionId: session.id,
    projectId,
    presetId,
    version: 1,
    storyboard,
  };
}

/** 세션 하나를 최신 버전의 스토리보드와 함께 읽는다. */
export async function getSession(sessionId: string): Promise<SavedSession | null> {
  const { data: session, error: sessionError } = await getDb()
    .from("sessions")
    .select("id, project_id, preset_id, subject")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) throw new Error(`세션 조회 실패: ${sessionError.message}`);
  if (!session) return null;

  const latest = await getLatestVersion(sessionId);
  // 세션 행은 있는데 버전이 없는 상태는 createSession의 롤백이 실패했을 때만
  // 나온다. 화면에 보여줄 스토리보드가 없으므로 없는 세션과 같게 취급한다.
  if (!latest) {
    console.error(`[getSession] 버전 없는 세션 ${sessionId} (롤백 실패 흔적)`);
    return null;
  }

  return {
    sessionId: session.id,
    projectId: session.project_id,
    presetId: session.preset_id,
    version: latest.version,
    storyboard: withCanonicalSubject(latest.storyboard, session.subject),
  };
}

/** 가장 큰 version 하나를 꺼낸다. */
async function getLatestVersion(
  sessionId: string
): Promise<{ version: number; storyboard: Storyboard } | null> {
  const { data, error } = await getDb()
    .from("session_versions")
    .select("version, storyboard")
    .eq("session_id", sessionId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`버전 조회 실패: ${error.message}`);
  if (!data) return null;

  return { version: data.version, storyboard: data.storyboard as Storyboard };
}

/**
 * 새 버전을 쌓는다. 되돌리기를 위해 이전 버전을 지우지 않는다.
 *
 * 다음 번호를 읽고 쓰는 사이에 다른 요청이 끼면 같은 번호를 노릴 수 있지만,
 * unique (session_id, version) 제약이 두 번째 요청을 막는다. 인증이 없는 단일
 * 사용자 전제라(lib/db/schema.sql) 재시도 로직은 두지 않는다.
 */
export async function saveSessionVersion(
  sessionId: string,
  storyboard: Storyboard
): Promise<SavedSession | null> {
  const { data: session, error: sessionError } = await getDb()
    .from("sessions")
    .select("id, project_id, preset_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) throw new Error(`세션 조회 실패: ${sessionError.message}`);
  if (!session) return null;

  const latest = await getLatestVersion(sessionId);
  if (!latest) return null;

  const nextVersion = latest.version + 1;

  const { error: insertError } = await getDb()
    .from("session_versions")
    .insert({ session_id: sessionId, version: nextVersion, storyboard });

  if (insertError) throw new Error(`버전 저장 실패: ${insertError.message}`);

  // subject의 정본은 컬럼이므로 스토리보드가 바뀌면 컬럼도 따라 갱신한다.
  // 이 갱신이 실패해도 스토리보드 자체는 저장됐으므로 요청을 실패시키지 않는다.
  if (storyboard.subject !== undefined) {
    const { error: subjectError } = await getDb()
      .from("sessions")
      .update({ subject: storyboard.subject })
      .eq("id", sessionId);
    if (subjectError) {
      console.error(
        `[saveSessionVersion] subject 갱신 실패 (세션 ${sessionId}):`,
        subjectError.message
      );
    }
  }

  return {
    sessionId,
    projectId: session.project_id,
    presetId: session.preset_id,
    version: nextVersion,
    storyboard,
  };
}

/**
 * 되돌리기 결과. 실패 두 가지를 null 하나로 합치지 않는 이유는 라우트가 응답
 * 코드를 나눠야 하기 때문이다 — 없는 세션은 404, 되돌릴 버전이 없는 것은 409다.
 */
export type RevertResult =
  | { ok: true; session: SavedSession }
  | { ok: false; reason: "session_not_found" | "no_previous_version" };

/**
 * 되돌리기 1단계. 직전 버전의 내용을 새 버전으로 복사한다 — 행을 지우지 않으므로
 * 오조작으로 내용이 사라지지 않는다.
 *
 *   v1[원본] v2[수정]  →  되돌리기  →  v1 v2 v3[=v1]
 *
 * 되돌리기를 한 번 더 누르면 그 시점의 직전인 v2가 v4로 복사된다. 즉 연속으로
 * 누르면 두 내용을 오가는 토글이 된다. PRD.md 3절이 버전 목록·diff UI를 제외했고
 * 되돌리기 1단계만 요구하므로 이 동작으로 충분하다.
 */
export async function revertSession(sessionId: string): Promise<RevertResult> {
  const { data: session, error: sessionError } = await getDb()
    .from("sessions")
    .select("id, project_id, preset_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) throw new Error(`세션 조회 실패: ${sessionError.message}`);
  if (!session) return { ok: false, reason: "session_not_found" };

  // 최신 두 개를 한 번에 가져온다. 두 번째가 되돌릴 대상이다.
  const { data: rows, error: rowsError } = await getDb()
    .from("session_versions")
    .select("version, storyboard")
    .eq("session_id", sessionId)
    .order("version", { ascending: false })
    .limit(2);

  if (rowsError) throw new Error(`버전 조회 실패: ${rowsError.message}`);
  if (!rows || rows.length < 2) return { ok: false, reason: "no_previous_version" };

  const [current, previous] = rows;
  const storyboard = previous.storyboard as Storyboard;
  const nextVersion = current.version + 1;

  const { error: insertError } = await getDb()
    .from("session_versions")
    .insert({ session_id: sessionId, version: nextVersion, storyboard });

  if (insertError) throw new Error(`되돌리기 실패: ${insertError.message}`);

  const { error: subjectError } = await getDb()
    .from("sessions")
    .update({ subject: storyboard.subject })
    .eq("id", sessionId);
  if (subjectError) {
    console.error(
      `[revertSession] subject 갱신 실패 (세션 ${sessionId}):`,
      subjectError.message
    );
  }

  return {
    ok: true,
    session: {
      sessionId,
      projectId: session.project_id,
      presetId: session.preset_id,
      version: nextVersion,
      storyboard,
    },
  };
}
