import { createSession, getSession, listSessions, StoryboardProtectionError } from "@/lib/db/sessions";
import { insertSelections, type SelectionInsert } from "@/lib/db/selections";
import {
  SELECTION_MAX_CANDIDATES,
  SELECTION_MAX_ROUNDS,
} from "@/lib/session/selection-log";
import { assertStoryboardShape, buildStoryboardJudge, loadDemoCacheValues } from "./validate";
const ASSET_URI_PATTERN = /^asset:\/\//;

/**
 * selections 배열 원소 하나를 검증해 저장용 행으로 바꾼다. 무효면 null을 돌려
 * 호출자가 버리고 로그만 남긴다 — 400으로 막지 않는다(세션 저장 보존이 우선).
 * selected_asset은 서버가 candidate_assets[selected_index]로 채운다.
 */
function toSelectionInsert(entry: unknown): SelectionInsert | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const r = entry as Record<string, unknown>;

  if (!Number.isInteger(r.cut_index) || (r.cut_index as number) < 1 || (r.cut_index as number) > 4) {
    return null;
  }
  if (!Number.isInteger(r.round) || (r.round as number) < 1 || (r.round as number) > SELECTION_MAX_ROUNDS) {
    return null;
  }
  if (
    !Array.isArray(r.candidate_assets) ||
    r.candidate_assets.length < 1 ||
    r.candidate_assets.length > SELECTION_MAX_CANDIDATES ||
    !r.candidate_assets.every((a) => typeof a === "string" && ASSET_URI_PATTERN.test(a))
  ) {
    return null;
  }
  if (!Number.isInteger(r.requested_count) || (r.requested_count as number) < 1) return null;
  if (r.outcome !== "selected" && r.outcome !== "regenerated") return null;
  if (typeof r.occurred_at !== "string" || Number.isNaN(Date.parse(r.occurred_at))) return null;

  const candidates = r.candidate_assets as string[];
  if (r.outcome === "selected") {
    if (
      !Number.isInteger(r.selected_index) ||
      (r.selected_index as number) < 0 ||
      (r.selected_index as number) >= candidates.length
    ) {
      return null;
    }
    const selectedIndex = r.selected_index as number;
    return {
      cutIndex: r.cut_index as number,
      round: r.round as number,
      candidateAssets: candidates,
      requestedCount: r.requested_count as number,
      selectedAsset: candidates[selectedIndex],
      variantIndex: selectedIndex,
      outcome: "selected",
      occurredAt: r.occurred_at as string,
    };
  }
  if (r.selected_index !== null) return null;
  return {
    cutIndex: r.cut_index as number,
    round: r.round as number,
    candidateAssets: candidates,
    requestedCount: r.requested_count as number,
    selectedAsset: null,
    variantIndex: null,
    outcome: "regenerated",
    occurredAt: r.occurred_at as string,
  };
}

/**
 * body.selections를 검증한다. 같은 (cut_index, round) 중복·무효 라운드는 버리고
 * 로그만 남긴다. 라운드는 최대 20개까지만 받는다.
 */
export function validateSelectionRounds(input: unknown): SelectionInsert[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const valid: SelectionInsert[] = [];
  input.forEach((entry, i) => {
    if (valid.length >= SELECTION_MAX_ROUNDS) {
      console.warn(`[POST /api/session] selections ${i}번째 이후 버림: 라운드 최대 ${SELECTION_MAX_ROUNDS}개`);
      return;
    }
    const row = toSelectionInsert(entry);
    if (!row) {
      console.warn(`[POST /api/session] 무효 selection 라운드 버림 (${i}번째)`);
      return;
    }
    const key = `${row.cutIndex}:${row.round}`;
    if (seen.has(key)) {
      console.warn(`[POST /api/session] 중복 selection 라운드 버림 (cut ${row.cutIndex}, round ${row.round})`);
      return;
    }
    seen.add(key);
    valid.push(row);
  });
  return valid;
}

export interface SessionPostDeps {
  createSession: typeof createSession;
  insertSelections: typeof insertSelections;
}

/**
 * POST 본문 처리 본체. lib/db를 직접 import하지 않고 deps로 받는다 —
 * 테스트에서 mock을 꽂는 자리다. 실제 POST는 아래에서 진짜 함수들을 넘긴다.
 */
export async function handleSessionPost(
  body: Record<string, unknown>,
  deps: SessionPostDeps,
  opts?: { demoCacheValues?: ReadonlySet<string> }
): Promise<Response> {
  const { projectId, presetId, storyboard } = body;

  if (typeof projectId !== "string" || typeof presetId !== "string") {
    return Response.json({ error: "projectId · presetId가 필요합니다" }, { status: 400 });
  }

  try {
    assertStoryboardShape(storyboard);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "스토리보드 검증 실패" },
      { status: 400 }
    );
  }

  // 새 세션은 baseline이 없어 예외 없음 — 계약 위반이 하나라도 있으면 400.
  const judge = buildStoryboardJudge(opts?.demoCacheValues);
  const problems = judge(storyboard, null);
  if (problems.length > 0) {
    return Response.json(
      {
        error: `스토리보드 계약 위반 ${problems.length}건`,
        code: "invalid_storyboard",
        problems,
      },
      { status: 400 }
    );
  }

  // selections 키 유무가 응답 형태를 가른다. 키가 있을 때(빈 배열 포함)는
  // selectionsSaved를 true/false로 항상 넣어 화면이 비차단 토스트를 띄울 수 있게
  // 하고, 키 자체가 없으면 필드를 생략해 기존 응답 형태를 유지한다.
  const hasSelections = Object.hasOwn(body, "selections");
  const selections = hasSelections ? validateSelectionRounds(body.selections) : null;

  // DB 실패는 요청 내용의 문제가 아니므로 400과 구분한다. 원문 메시지는 내부
  // 정보(테이블명·제약조건)를 담으므로 응답에 넣지 않고 로그로만 남긴다.
  try {
    const saved = await deps.createSession(
      { projectId, presetId, storyboard },
      judge
    );
    const payload: Record<string, unknown> = {
      sessionId: saved.sessionId,
      version: saved.version,
    };
    if (selections !== null) {
      // createSession 성공 뒤에 저장한다. 끝내 실패해도 세션 저장은 200으로
      // 응답한다 — 사용자 작업 보존 우선. valid가 비었으면 저장할 게 없으므로 성공이다.
      try {
        await deps.insertSelections(saved.sessionId, selections);
        payload.selectionsSaved = true;
      } catch (e) {
        console.error("[POST /api/session] 선택 기록 저장 실패:", e);
        payload.selectionsSaved = false;
      }
    }
    return Response.json(payload);
  } catch (e) {
    if (e instanceof StoryboardProtectionError) {
      return Response.json(
        {
          error: e.message,
          code: "invalid_storyboard",
          problems: e.problems,
        },
        { status: 400 }
      );
    }
    console.error("[POST /api/session] 저장 실패:", e);
    return Response.json({ error: "세션 저장에 실패했습니다" }, { status: 500 });
  }
}

/** 세션 생성 + 첫 버전 저장. body: { projectId, presetId, storyboard, selections? } */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  return handleSessionPost((body ?? {}) as Record<string, unknown>, {
    createSession,
    insertSelections,
  }, {
    demoCacheValues: await loadDemoCacheValues(),
  });
}

/** sessions.id는 uuid다. 형식이 다르면 DB에 물어보지 않는다 — PostgREST가
 *  "invalid input syntax for type uuid"를 뱉어 500이 되므로 없는 세션과 같게
 *  404로 취급한다. 화면은 !res.ok를 새 골든패스로 둔다. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 최신 버전의 스토리보드와 함께 세션을 읽는다. id 없이 호출하면 목록을 준다. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  // id가 없으면 세션 목록을 준다. GET /api/preset과 같은 패턴이다. projectId가
  // 있으면 그 프로젝트 것만 거른다 — 없으면 프로젝트를 열었을 때 남의 프로젝트
  // 세션까지 섞인다.
  if (!id) {
    const projectId = url.searchParams.get("projectId") ?? undefined;
    try {
      return Response.json({ sessions: await listSessions({ projectId }) });
    } catch (e) {
      console.error("[GET /api/session] 목록 조회 실패:", e);
      return Response.json({ error: "세션 목록 조회에 실패했습니다" }, { status: 500 });
    }
  }

  if (!UUID_PATTERN.test(id)) {
    return Response.json({ error: "없음" }, { status: 404 });
  }

  try {
    const found = await getSession(id);
    if (!found) return Response.json({ error: "없음" }, { status: 404 });
    return Response.json(found);
  } catch (e) {
    console.error("[GET /api/session] 조회 실패:", e);
    return Response.json({ error: "세션 조회에 실패했습니다" }, { status: 500 });
  }
}
