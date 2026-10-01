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
 * 전체 시간 예산(deadline). selections 저장 시작 시점부터 잰다. 소량 insert에
 * 저장 버튼 응답성을 더한 캡틴 결정값이다.
 */
export const SELECTION_BUDGET_MS = 3000;

/** 시도별 타임아웃 상한. 실제 타임아웃은 min(1,000ms, 남은 예산)이다. */
export const SELECTION_ATTEMPT_TIMEOUT_MS = 1000;

/** 재시도 간격(남은 예산 안에서만 쉰다). */
export const SELECTION_RETRY_DELAYS_MS = [200, 400] as const;

/**
 * 다음 1회 시도를 걸 최소 남은 예산. 이보다 적으면 시도하지 않고 포기한다 —
 * 타임아웃·왕복에 못 미치는 시도는 예산만 갉아먹기 때문이다.
 */
export const SELECTION_MIN_ATTEMPT_BUDGET_MS = 300;

/**
 * 무한루프 방지용 안전망. 고정 재시도 횟수 규칙이 아니라 예산이 시도 횟수를
 * 결정한다(시도·백오프가 예산을 갉아먹어 언젠가 300ms 밑으로 떨어진다). 이 상수는
 * 즉시 실패가 반복돼 예산이 줄지 않는 비정상 흐름에서만 걸린다 — 실측 왕복
 * p50 120~175ms 기준으로 정상 흐름에선 예산이 먼저 바닥난다.
 */
export const SELECTION_MAX_ATTEMPTS = 20;

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
 * 다시 보내도 같은 자리에서 실패한다. 시도 타임아웃(AbortSignal.timeout)도
 * code ''·status 0으로 돌아오므로(PostgrestTransformBuilder.abortSignal TSDoc의
 * Set a timeout 예시 응답) 일시 오류로 분류돼 재시도된다.
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
  /** 전체 예산 덮어쓰기(기본 SELECTION_BUDGET_MS). 테스트용. */
  budgetMs?: number;
  /** 현재 시각 덮어쓰기(기본 Date.now). 테스트용 가짜 시계. */
  now?: () => number;
}

/**
 * 선택 기록을 일괄 저장한다. (session_id, cut_index, round) 충돌은 무시한다 —
 * 응답 유실 뒤 재시도처럼 같은 묶음이 두 번 와도 행이 늘지 않으므로, 충돌 없이
 * 끝난 것과 중복으로 끝난 것 모두 성공으로 본다(upsert onConflict do nothing).
 *
 * 일시적 오류에 한해 전체 예산(SELECTION_BUDGET_MS) 안에서 재시도한다.
 * 시도별 타임아웃은 min(1,000ms, 남은 예산)이고, 백오프(200·400ms)는 남은 예산
 * 안에서만 쉰다. 다음 시도에 쓸 남은 예산이 300ms 미만이면 시도하지 않고
 * 포기한다. 예산을 넘기면 던지고, 호출자(POST /api/session)는 세션 200 +
 * selectionsSaved:false로 응답한다. rounds가 비어 있으면 DB에 닿지 않고 끝난다.
 *
 * 예산 근거 — 읽기 전용 select 왕복 실측(n=14·15, 2026-10-01):
 * sessions 콜드 제외 p50 175·p90 311·max 328ms, selections p50 123·p90 255·
 * max 274ms, 콜드 첫 호출 1,532ms. selections 저장 직전 createSession이 같은
 * DB에 2회 왕복(sessions insert·session_versions insert)해 연결이 데워져
 * 있으므로 콜드 비용은 제외한다. 시도별 1초 = 따뜻한 p90(약 300ms)의 약 3배
 * (쓰기 여유 — 쓰기 지연은 실DB 쓰기 금지라 미측정). 전체 3초는 캡틴 결정이다.
 */
export async function insertSelections(
  sessionId: string,
  rounds: SelectionInsert[],
  deps?: InsertSelectionsDeps
): Promise<void> {
  if (rounds.length === 0) return;

  const client = deps?.client ?? getDb();
  const sleep = deps?.sleep ?? defaultSleep;
  const budgetMs = deps?.budgetMs ?? SELECTION_BUDGET_MS;
  const now = deps?.now ?? Date.now;
  const deadline = now() + budgetMs;

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
  let attempts = 0;

  for (;;) {
    const remaining = deadline - now();
    if (remaining < SELECTION_MIN_ATTEMPT_BUDGET_MS || attempts >= SELECTION_MAX_ATTEMPTS) {
      throw new Error(
        lastFailure?.message
          ? `선택 기록 저장 실패(예산 ${budgetMs}ms 소진): ${lastFailure.message}`
          : `선택 기록 저장 실패(예산 ${budgetMs}ms 안에 시도 불가)`
      );
    }
    attempts++;

    // 시도마다 타임아웃을 건다(.abortSignal은 PostgrestTransformBuilder의 실재
    // API다 — src/PostgrestTransformBuilder.ts). 매달린 연결을 끊어야 위
    // 재시도 분류가 동작한다.
    const { error, status } = await client
      .from("selections")
      .upsert(rows, {
        onConflict: "session_id,cut_index,round",
        ignoreDuplicates: true,
      })
      .abortSignal(AbortSignal.timeout(Math.min(SELECTION_ATTEMPT_TIMEOUT_MS, remaining)));

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

    const backoff =
      SELECTION_RETRY_DELAYS_MS[Math.min(attempts - 1, SELECTION_RETRY_DELAYS_MS.length - 1)];
    // 예산이 바닥났으면 쉬지 않고 바로 포기한다.
    const afterAttempt = deadline - now();
    if (afterAttempt > 0) {
      await sleep(Math.min(backoff, afterAttempt));
    }
  }
}
