/**
 * 표지 선택 기록 헬퍼(issue #207). 순수 모듈이라 클라이언트·서버 어디서든 쓴다 —
 * 서버 모듈·DB import 금지. 화면(JEON-DAEJIN 몫, M5)이 표지를 보여주고 고를 때마다
 * 이 4개만 호출한다: recordRound → markRegenerated|markSelected → toPayload.
 *
 * 한 라운드 = 화면에 보여준 후보 한 묶음. 라운드 번호는 1부터 증가한다.
 * 열린 라운드 = outcome이 아직 null인 마지막 라운드. 열린 라운드가 없으면
 * markRegenerated·markSelected는 아무 것도 바꾸지 않고 로그를 그대로 둔다.
 * 모든 함수는 불변 객체를 반환한다(들어온 log를 고치지 않는다).
 *
 * 표지 선택은 cuts[0] 전용이라 cut_index는 1로 고정한다.
 */

export type SelectionOutcome = "selected" | "regenerated";

/** POST /api/session body의 selections 배열 원소 모양. */
export interface SelectionRound {
  cut_index: number;
  round: number;
  candidate_assets: string[];
  requested_count: number;
  selected_index: number | null;
  outcome: SelectionOutcome;
  occurred_at: string;
}

interface LogRound {
  round: number;
  candidateAssets: string[];
  requestedCount: number;
  selectedIndex: number | null;
  outcome: SelectionOutcome | null;
  occurredAt: string | null;
}

export interface SelectionLog {
  rounds: LogRound[];
}

/** 빈 기록을 만든다. */
export function createSelectionLog(): SelectionLog {
  return { rounds: [] };
}

function toIso(now: Date | undefined): string {
  return (now ?? new Date()).toISOString();
}

/**
 * 후보 묶음을 보여줄 때마다 한 라운드를 연다. round는 1부터 증가한다.
 * 이전에 열린 라운드가 닫히지 않았으면 그대로 두고 새 라운드를 연다 —
 * 화면은 다시 뽑기할 때 markRegenerated를 먼저 부르므로 정상 흐름에선 겹치지 않는다.
 */
export function recordRound(
  log: SelectionLog,
  variants: { asset: string }[],
  requested: number,
  now?: Date
): SelectionLog {
  void now;
  return {
    rounds: [
      ...log.rounds,
      {
        round: log.rounds.length + 1,
        candidateAssets: variants.map((v) => v.asset),
        requestedCount: requested,
        selectedIndex: null,
        outcome: null,
        occurredAt: null,
      },
    ],
  };
}

/** 열린 라운드를 "다시 뽑기로 버림"으로 닫는다. 열린 라운드가 없으면 그대로 둔다. */
export function markRegenerated(log: SelectionLog, now?: Date): SelectionLog {
  const last = log.rounds[log.rounds.length - 1];
  if (!last || last.outcome !== null) return log;
  return {
    rounds: [
      ...log.rounds.slice(0, -1),
      { ...last, outcome: "regenerated", selectedIndex: null, occurredAt: toIso(now) },
    ],
  };
}

/** 열린 라운드에서 index번째를 고름으로 닫는다. 열린 라운드가 없으면 그대로 둔다. */
export function markSelected(log: SelectionLog, index: number, now?: Date): SelectionLog {
  const last = log.rounds[log.rounds.length - 1];
  if (!last || last.outcome !== null) return log;
  return {
    rounds: [
      ...log.rounds.slice(0, -1),
      { ...last, outcome: "selected", selectedIndex: index, occurredAt: toIso(now) },
    ],
  };
}

/**
 * 서버 전송용 배열로 바꾼다. 결말이 정해진(닫힌) 라운드만 담는다 — 아직 열려 있는
 * 라운드는 outcome·selected_index가 없어 서버 검증에 통과할 수 없으므로 뺀다.
 */
export function toPayload(log: SelectionLog): SelectionRound[] {
  return log.rounds
    .filter((r) => r.outcome !== null && r.occurredAt !== null)
    .map((r) => ({
      cut_index: 1,
      round: r.round,
      candidate_assets: [...r.candidateAssets],
      requested_count: r.requestedCount,
      selected_index: r.selectedIndex,
      outcome: r.outcome as SelectionOutcome,
      occurred_at: r.occurredAt as string,
    }));
}
