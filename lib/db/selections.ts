import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "./client";

/**
 * insertSelections가 한 번에 저장하는 라운드 한 묶음의 한 행이다. 화면이 보여준
 * 후보 묶음 그 자체이며, lib/session/selection-log.ts의 toPayload가 이 모양으로
 * 내놓은 것을 POST /api/session이 검증한 뒤 서버에서 selected_asset을 채워 넘긴다.
 */
export interface SelectionInsert {
  cutIndex: number;
  round: number;
  candidateAssets: string[];
  requestedCount: number;
  /** 고른 asset. 버린 라운드(regenerated)면 null이다. */
  selectedAsset: string | null;
  /** 고른 위치. 버린 라운드면 null이다. */
  variantIndex: number | null;
  outcome: "selected" | "regenerated";
  occurredAt: string;
}

/**
 * 재시도 간격. 최악 추가 대기 200+400+800 = 1.4초(+시도 시간) — 저장 버튼
 * 응답성을 우선해 이 이상은 늘리지 않는다.
 */
export const SELECTION_RETRY_DELAYS_MS = [200, 400, 800] as const;

/** 최대 3회 재시도 = 총 4번 시도. */
export const SELECTION_MAX_RETRIES = 3;

export type SelectionSleep = (ms: number) => Promise<void>;

const defaultSleep: SelectionSleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** supabase-js가 돌려주는 실패의 최소 모양. status는 error 안이 아니라 응답에 붙는다. */
export interface SelectionFailure {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
}

/**
 * 일시적 오류 판정. 근거는 node_modules의 실제 구현이다.
 *
 * - 네트워크·타임아웃·연결 실패는 throw가 아니라 { error }로 돌아오며, 이때
 *   code는 ''(빈 문자열), message는 "FetchError: ..."/"TypeError: ..."/
 *   "AbortError: ..." 형태, 응답 status는 0이다
 *   (@supabase/postgrest-js src/PostgrestBuilder.ts의 fetch 실패 catch절 —
 *   "We don't populate code/hint for client-side network errors").
 *   error 형태 자체는 src/PostgrestError.ts의 { message, details, hint, code }다.
 * - PostgREST·Postgres 오류는 code에 PGRSTxxx 또는 PG 코드(23xxx 제약 위반·
 *   22xxx 형식 오류·42501 등), 응답 status에 HTTP 상태가 들어간다
 *   (같은 파일 processResponse — status는 res.status 그대로).
 * - POST 계열은 postgrest-js가 자동 재시도하지 않는다(GET/HEAD/OPTIONS만
 *   하므로 shouldRetry가 POST를 제외한다). 그래서 여기서 직접 재시도한다.
 *
 * 재시도 대상 = status 0(연결 실패)·HTTP 5xx·code ''(네트워크 계열 메시지에 한함)·
 * PGRST5xx. 그 외 4xx·PG 23xxx·22xxx 등 제약·형식 위반은 재시도하지 않는다 —
 * 다시 보내도 같은 자리에서 실패한다.
 */
export function isTransientSelectionError(failure: SelectionFailure | null | undefined): boolean {
  if (!failure) return false;

  if (typeof failure.status === "number") {
    if (failure.status === 0) return true;
    if (failure.status >= 500) return true;
    return false;
  }

  const code = failure.code ?? "";
  if (code === "") {
    return /fetch|network|timeout|abort|econn|enotfound|eai_again|socket|und_err|failed to fetch/i.test(
      failure.message ?? ""
    );
  }
  if (/^PGRST5/.test(code)) return true;
  return false;
}

export interface InsertSelectionsDeps {
  client?: SupabaseClient;
  sleep?: SelectionSleep;
}

/**
 * 선택 기록을 일괄 저장한다. (session_id, cut_index, round) 충돌은 무시한다 —
 * 응답 유실 뒤 재시도처럼 같은 묶음이 두 번 와도 행이 늘지 않으므로, 충돌 없이
 * 끝난 것과 중복으로 끝난 것 모두 성공으로 본다(upsert onConflict do nothing).
 *
 * 일시적 오류에 한해 최대 3회 재시도한다(총 4번 시도, 백오프 200·400·800ms).
 * rounds가 비어 있으면 DB에 닿지 않고 바로 끝난다.
 */
export async function insertSelections(
  sessionId: string,
  rounds: SelectionInsert[],
  deps?: InsertSelectionsDeps
): Promise<void> {
  if (rounds.length === 0) return;

  const client = deps?.client ?? getDb();
  const sleep = deps?.sleep ?? defaultSleep;

  const rows = rounds.map((r) => ({
    session_id: sessionId,
    cut_index: r.cutIndex,
    round: r.round,
    candidate_assets: r.candidateAssets,
    requested_count: r.requestedCount,
    selected_asset: r.selectedAsset,
    variant_index: r.variantIndex,
    outcome: r.outcome,
    occurred_at: r.occurredAt,
  }));

  let lastFailure: SelectionFailure | null = null;

  for (let attempt = 0; attempt <= SELECTION_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(SELECTION_RETRY_DELAYS_MS[attempt - 1]);
    }

    const { error, status } = await client
      .from("selections")
      .upsert(rows, {
        onConflict: "session_id,cut_index,round",
        ignoreDuplicates: true,
      });

    if (!error) return;

    const failure: SelectionFailure = {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      status,
    };
    lastFailure = failure;

    if (!isTransientSelectionError(failure)) {
      throw new Error(`선택 기록 저장 실패: ${error.message}`);
    }
  }

  throw new Error(
    `선택 기록 저장 실패(재시도 ${SELECTION_MAX_RETRIES}회 소진): ${lastFailure?.message ?? "알 수 없는 오류"}`
  );
}
