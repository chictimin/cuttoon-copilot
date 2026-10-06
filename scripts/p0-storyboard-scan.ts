// scripts/p0-storyboard-scan.ts — spec-263 rev4 3-5 P0 실DB 읽기 전용 조사.
//
// 사용:
//   npx tsx scripts/p0-storyboard-scan.ts --self-test            (PM 승인 전 실행 가능)
//   npx tsx scripts/p0-storyboard-scan.ts --cutoff <ISO 시각>    (PM→캡틴 확인 후에만)
//
// 쓰기 0 보장:
// - 스크립트 전용 Supabase 클라이언트에 커스텀 fetch 차단기. GET·HEAD만 통과,
//   경로는 PostgREST의 session_versions·sessions·presets 테이블만. 그 밖
//   (insert·update·delete·rpc 포함)은 네트워크에 닿기 전에 예외.
// - 실행 전 자가 시험: 차단기에 insert·update·delete·rpc 4종을 보내 전부 차단
//   확인 뒤에만 조회 시작. 자격 증명은 C-6b service role + 차단기.
// - import는 순수 판정 함수(A의 storyboardContractProblems)·preset probe만.
//   lib/db/*·asset·OpenAI 모듈 import 금지.
// - 모든 요청의 method·table·status·행 수를 로그(키·본문·URL 쿼리 값 출력 금지).
// - 행 수 전후 비교는 쓰기 0의 증거로 쓰지 않는다(update는 행 수 불변).
//
// 완전성: cutoff T0(created_at <= T0) 고정 → 같은 필터로 count(HEAD) → id
// 오름차순 페이지(500행) 전수 → 읽은 행 수 = count, id 중복·누락 0 확인.
// 최신 버전 = 그 집합의 세션별 최대 version. 고아 version·버전 없는 세션 별도 집계.
// "최근 7일" = session_versions.created_at 기준.
//
// 스냅샷 한계: created_at cutoff는 새 행 유입만 막고 동시 UPDATE는 막지 못한다.
// - session_versions: 앱 코드에 UPDATE 경로 없음(lib/db/sessions.ts의 update는
//   sessions 테이블만). 앱 밖 수동 수정은 범위 밖으로 표기.
// - presets: .update({ data }) 경로 있음, 수정 시각 컬럼 없음 → 전수 2회 읽기
//   (시작·끝) 후 행별 data 해시 비교, 달라진 행은 "조사 중 변경" 목록으로 분리.
// - sessions: 최신 버전 판정에 쓰지 않음(최신은 session_versions 최대 version) —
//   고아 집계에만 사용.
//
// 출력: 규칙·locator 종류별 건수(전 버전 / 최신 / 7일). 예시는 세션 id의 앞 8자
// 해시·version·locator·값 타입만(대사 원문·raw 출력 금지).
//
// 종료 코드: 자가 시험 통과 0 / 실패 1. 전체 조사 완료 0, 60초 초과·부분 결과 1
// (합격 아님), --cutoff 없음 1.
//
// storyboardContractProblems는 개발자 A의 P1-a 결과물(lib/llm/storyboard-guard.ts)
// 이다. A 머지 전에는 이 파일에 없어서 정적 import를 걸 수 없으므로(걸면 tsc 실패),
// 동적 import로 읽고 없으면 전체 조사를 중단한다. A의 P1-a 커밋을 머지한 뒤에는
// 아래 loadStoryboardJudge 부분을 정적 import로 바꾼다.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { presetContractProbe, type PresetProbeProblem } from "../lib/llm/preset-guard";

// A의 P1-a가 만드는 판정 함수와 같은 구조. 정적 import로 바꾸기 전까지의 자리 표시.
interface ContractProblemLike {
  rule: string;
  locator: string;
  kind: string;
  cause: unknown;
}
type StoryboardJudge = (sb: unknown, ctx: { demoCacheValues?: ReadonlySet<string> }) => ContractProblemLike[];

async function loadStoryboardJudge(): Promise<StoryboardJudge | null> {
  const mod = (await import("../lib/llm/storyboard-guard")) as Record<string, unknown>;
  const fn = mod["storyboardContractProblems"];
  return typeof fn === "function" ? (fn as StoryboardJudge) : null;
}

// ── 요청 로그 (키·본문·URL 쿼리 값 출력 금지: method·table·status·행 수만) ──

interface RequestLogEntry {
  t: string;
  method: string;
  table: string;
  verdict: "allowed" | "blocked";
  status?: number;
  rows?: number;
}

const requestLog: RequestLogEntry[] = [];

function logRequest(entry: RequestLogEntry): void {
  requestLog.push(entry);
  const extra =
    entry.verdict === "allowed" ? ` status=${entry.status ?? "-"} rows=${entry.rows ?? "-"}` : "";
  console.log(`[p0-req] ${entry.t} ${entry.method} ${entry.table} ${entry.verdict}${extra}`);
}

// ── 커스텀 fetch 차단기 ──

const ALLOWED_TABLES = ["session_versions", "sessions", "presets"] as const;

function classifyRequest(method: string, url: string): { verdict: "allowed" | "blocked"; table: string } {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return { verdict: "blocked", table: "unparseable-url" };
  }
  const m = path.match(/^\/rest\/v1\/([A-Za-z_]+)(?:[/?]|$)/);
  const table = m ? (m[1] as string) : path.split("/").filter(Boolean).slice(-2).join("/") || path;
  if ((method === "GET" || method === "HEAD") && m && (ALLOWED_TABLES as readonly string[]).includes(m[1] as string)) {
    return { verdict: "allowed", table: m[1] as string };
  }
  return { verdict: "blocked", table };
}

function guardedFetch(
  underlying: typeof fetch
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") ?? "GET").toUpperCase();
    const { verdict, table } = classifyRequest(method, url);
    if (verdict === "blocked") {
      logRequest({ t: new Date().toISOString(), method, table, verdict: "blocked" });
      throw new Error(`[p0-guard-blocked] ${method} ${table} — 쓰기·비허용 경로는 차단됨`);
    }
    const res = await underlying(url, init);
    let rows: number | undefined;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const clone = res.clone();
      try {
        const body: unknown = await clone.json();
        rows = Array.isArray(body) ? body.length : 1;
      } catch {
        rows = undefined;
      }
    } else {
      const range = res.headers.get("content-range");
      const total = range?.split("/")[1];
      rows = total !== undefined && total !== "*" ? Number(total) : undefined;
    }
    logRequest({ t: new Date().toISOString(), method, table, verdict: "allowed", status: res.status, rows });
    return res;
  };
}

function createGuardedClient(url: string, key: string, underlying: typeof fetch): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: guardedFetch(underlying) },
  });
}

// ── .env 로더 (키 출력 금지 — 값은 절대 로그에 찍지 않음) ──

function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

// ── 자가 시험: 쓰기 4종(insert·update·delete·rpc)이 전부 차단되는지 ──

async function runSelfTest(): Promise<void> {
  let underlyingCalls = 0;
  const neverFetch: typeof fetch = async () => {
    underlyingCalls += 1;
    throw new Error("[p0-selftest] underlying fetch에 닿음 — 차단기 우회");
  };
  const client = createGuardedClient("https://selftest.invalid", "selftest-key", neverFetch);

  const cases: { name: string; run: () => PromiseLike<unknown> }[] = [
    { name: "insert", run: () => client.from("session_versions").insert({}).select() },
    { name: "update", run: () => client.from("presets").update({}).eq("id", "selftest") },
    { name: "delete", run: () => client.from("sessions").delete().eq("id", "selftest") },
    { name: "rpc", run: () => client.rpc("selftest_fn") },
  ];

  let bad = 0;
  for (const c of cases) {
    // supabase-js는 fetch 예외를 throw 대신 { error } 응답으로 감싸서 돌려줄 수
    // 있다. 어느 쪽이든 차단기 표식([p0-guard-blocked])이 있어야 차단 성공이다.
    let marker = "";
    try {
      const res = (await c.run()) as { error?: { message?: string } | null };
      marker = res?.error?.message ?? "";
      if (!marker) {
        bad += 1;
        console.error(`FAIL selftest-${c.name}: 에러 없이 통과함(차단 안 됨)`);
        continue;
      }
    } catch (err) {
      marker = (err as Error).message ?? "";
    }
    if (marker.includes("[p0-guard-blocked]")) {
      console.log(`ok   selftest-${c.name}: 차단됨`);
    } else {
      bad += 1;
      console.error(`FAIL selftest-${c.name}: 차단기 외 경로로 실패함: ${marker.slice(0, 120)}`);
    }
  }

  // 허용 경로는 decide() 단위 판정만 확인(네트워크 호출 없음).
  const allowChecks: [string, string][] = [
    ["GET", "https://x.invalid/rest/v1/session_versions?select=id"],
    ["GET", "https://x.invalid/rest/v1/sessions?select=id"],
    ["HEAD", "https://x.invalid/rest/v1/presets?select=id"],
  ];
  for (const [method, url] of allowChecks) {
    const r = classifyRequest(method, url);
    if (r.verdict !== "allowed") {
      bad += 1;
      console.error(`FAIL selftest-allow: ${method} ${r.table}이 차단됨`);
    } else {
      console.log(`ok   selftest-allow: ${method} ${r.table}`);
    }
  }

  const blocked = requestLog.filter((e) => e.verdict === "blocked").length;
  const allowed = requestLog.filter((e) => e.verdict === "allowed").length;
  if (blocked !== 4 || allowed !== 0 || underlyingCalls !== 0) {
    bad += 1;
    console.error(
      `FAIL selftest-log: blocked=${blocked}(기대 4) allowed=${allowed}(기대 0) underlying=${underlyingCalls}(기대 0)`
    );
  } else {
    console.log(`ok   selftest-log: blocked 4종, 허용·실네트워크 0`);
  }

  if (bad > 0) {
    console.error(`\n${bad}건 실패 — 조회 시작 금지`);
    process.exit(1);
  }
  console.log("OK P0-SELFTEST");
}

// ── 전체 조사 ──

function sha8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function valueType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

interface VersionRow {
  id: string;
  session_id: string;
  version: number;
  storyboard: unknown;
  created_at: string;
}

const PAGE = 500;
const BUDGET_MS = 60_000;

async function countWithCutoff(
  client: SupabaseClient,
  table: string,
  cutoff: string
): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .lte("created_at", cutoff);
  if (error) throw new Error(`${table} count 실패: ${error.message}`);
  return count ?? 0;
}

async function readAllWithCutoff(
  client: SupabaseClient,
  table: string,
  columns: string,
  cutoff: string,
  startedAt: number,
  deadlineNote: { partial: boolean }
): Promise<{ rows: Record<string, unknown>[]; partial: boolean; stoppedAfter: number }> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    if (Date.now() - startedAt > BUDGET_MS) {
      deadlineNote.partial = true;
      return { rows, partial: true, stoppedAfter: from };
    }
    const { data, error } = await client
      .from(table)
      .select(columns)
      .lte("created_at", cutoff)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} 읽기 실패(offset ${from}): ${error.message}`);
    const page = ((data ?? []) as unknown) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, partial: false, stoppedAfter: from + page.length };
    from += PAGE;
  }
}

async function runSurvey(cutoff: string): Promise<void> {
  const startedAt = Date.now();
  const deadlineNote = { partial: false };

  loadEnvFile(new URL("../.env", import.meta.url).pathname);
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    console.error("FAIL SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없음 (.env 확인)");
    process.exit(1);
  }

  // 자가 시험 통과 뒤에만 조회 시작.
  await runSelfTest();
  requestLog.length = 0;

  const judge = await loadStoryboardJudge();
  if (!judge) {
    console.error("FAIL storyboardContractProblems를 찾지 못함(P1-a 미머지) — 미조사 범위: 전체");
    process.exit(1);
  }

  const client = createGuardedClient(url, key, fetch);
  const cutoffTime = new Date(cutoff).getTime();
  if (Number.isNaN(cutoffTime)) {
    console.error(`FAIL --cutoff 시각 파싱 실패: ${cutoff}`);
    process.exit(1);
  }
  const weekAgo = new Date(cutoffTime - 7 * 24 * 3600 * 1000).toISOString();

  const counts: Record<string, number> = {};
  for (const table of ["session_versions", "sessions", "presets"]) {
    counts[table] = await countWithCutoff(client, table, cutoff);
    console.log(`[p0-count] ${table} cutoff=${cutoff} count=${counts[table]}`);
  }

  const presetsFirst = await readAllWithCutoff(client, "presets", "id,data,created_at", cutoff, startedAt, deadlineNote);
  const versionsRead = await readAllWithCutoff(
    client,
    "session_versions",
    "id,session_id,version,storyboard,created_at",
    cutoff,
    startedAt,
    deadlineNote
  );
  const sessionsRead = await readAllWithCutoff(client, "sessions", "id,created_at", cutoff, startedAt, deadlineNote);
  const presetsSecond = await readAllWithCutoff(client, "presets", "id,data", cutoff, startedAt, deadlineNote);

  // 완전성: 읽은 행 수 = count, id 중복·누락 0.
  const completeness: string[] = [];
  const pairs: [string, Record<string, unknown>[]][] = [
    ["session_versions", versionsRead.rows],
    ["sessions", sessionsRead.rows],
    ["presets", presetsFirst.rows],
  ];
  for (const [table, rows] of pairs) {
    const ids = rows.map((r) => String(r["id"]));
    const dup = ids.length - new Set(ids).size;
    const ok = rows.length === counts[table] && dup === 0;
    completeness.push(`${table}: 읽음=${rows.length} count=${counts[table]} 중복=${dup} ${ok ? "일치" : "불일치"}`);
  }

  // presets 2회 읽기 해시 비교. 달라진 행은 집계에서 제외.
  const hashData = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const firstById = new Map(presetsFirst.rows.map((r) => [String(r["id"]), r]));
  const changedPresetIds = new Set<string>();
  for (const r of presetsSecond.rows) {
    const id = String(r["id"]);
    const first = firstById.get(id);
    if (!first || hashData(first["data"]) !== hashData(r["data"])) changedPresetIds.add(id);
  }
  for (const r of presetsFirst.rows) {
    if (!presetsSecond.rows.some((s) => String(s["id"]) === String(r["id"]))) changedPresetIds.add(String(r["id"]));
  }

  const versions = versionsRead.rows as unknown as VersionRow[];
  const sessionIds = new Set(sessionsRead.rows.map((r) => String(r["id"])));

  // 최신 버전 = 집합의 세션별 최대 version.
  const latestBySession = new Map<string, VersionRow>();
  for (const v of versions) {
    const cur = latestBySession.get(v.session_id);
    if (!cur || v.version > cur.version) latestBySession.set(v.session_id, v);
  }
  const orphans = versions.filter((v) => !sessionIds.has(v.session_id)).length;
  const sessionsWithoutVersions = [...sessionIds].filter(
    (id) => ![...latestBySession.keys()].includes(id)
  ).length;

  // 판정 집계: 전 버전 / 최신 / 7일.
  type Bucket = { counts: Map<string, number>; examples: { idHash: string; version: number; locator: string; vtype: string }[] };
  const buckets: Record<"all" | "latest" | "week", Bucket> = {
    all: { counts: new Map(), examples: [] },
    latest: { counts: new Map(), examples: [] },
    week: { counts: new Map(), examples: [] },
  };
  const latestIds = new Set([...latestBySession.values()].map((v) => v.id));
  const bump = (b: Bucket, rule: string, kind: string, ex: Bucket["examples"][number]): void => {
    const k = `${rule}:${kind}`;
    b.counts.set(k, (b.counts.get(k) ?? 0) + 1);
    if (b.examples.length < 5) b.examples.push(ex);
  };
  for (const v of versions) {
    let problems: ContractProblemLike[];
    try {
      problems = judge(v.storyboard, {});
    } catch {
      problems = [{ rule: "JUDGE-THROW", locator: "storyboard", kind: "type", cause: null }];
    }
    for (const p of problems) {
      const ex = { idHash: sha8(v.session_id), version: v.version, locator: p.locator, vtype: valueType(p.cause) };
      bump(buckets.all, p.rule, p.kind, ex);
      if (latestIds.has(v.id)) bump(buckets.latest, p.rule, p.kind, ex);
      if (v.created_at >= weekAgo) bump(buckets.week, p.rule, p.kind, ex);
    }
  }

  // preset probe: 변경 행 제외.
  const probeCounts = new Map<string, number>();
  const probeExamples: { idHash: string; locator: string; vtype: string }[] = [];
  for (const r of presetsFirst.rows) {
    const id = String(r["id"]);
    if (changedPresetIds.has(id)) continue;
    const found: PresetProbeProblem[] = presetContractProbe(r["data"]);
    for (const p of found) {
      const k = `${p.rule}:${p.kind}`;
      probeCounts.set(k, (probeCounts.get(k) ?? 0) + 1);
      if (probeExamples.length < 5) {
        probeExamples.push({ idHash: sha8(id), locator: p.locator, vtype: valueType(p.cause) });
      }
    }
  }

  const elapsed = Date.now() - startedAt;
  const partial =
    deadlineNote.partial || versionsRead.partial || sessionsRead.partial || presetsFirst.partial || presetsSecond.partial || elapsed > BUDGET_MS;

  console.log(`\n[p0-result] cutoff=${cutoff} 소요=${elapsed}ms`);
  console.log(`[p0-completeness] ${completeness.join(" / ")}`);
  console.log(`[p0-versions] 최신세션=${latestBySession.size} 고아version=${orphans} 버전없는세션=${sessionsWithoutVersions}`);
  console.log(`[p0-presets] 2회읽기 변경행=${changedPresetIds.size} (집계 제외)`);
  for (const [name, b] of Object.entries(buckets) as [keyof typeof buckets, Bucket][]) {
    const rows = [...b.counts.entries()].map(([k, n]) => `${k}=${n}`).join(" ") || "위반 0";
    console.log(`[p0-storyboard-${name}] ${rows}`);
    for (const e of b.examples) console.log(`  예시 idHash=${e.idHash} version=${e.version} locator=${e.locator} 값타입=${e.vtype}`);
  }
  const probeRow = [...probeCounts.entries()].map(([k, n]) => `${k}=${n}`).join(" ") || "위반 0";
  console.log(`[p0-preset-probe] ${probeRow}`);
  for (const e of probeExamples) console.log(`  예시 idHash=${e.idHash} locator=${e.locator} 값타입=${e.vtype}`);

  if (partial) {
    console.log(`[p0-partial] 부분 결과 — 미조사 범위: ${versionsRead.stoppedAfter}행 이후(session_versions) (불합격)`);
    process.exit(1);
  }
  console.log("스냅샷 아님 — session_versions는 앱 UPDATE 경로 없음 전제, presets는 2회 읽기 해시 비교, sessions는 고아 집계에만 사용");
}

// ── 진입 ──

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    await runSelfTest();
  } else if (args.includes("--cutoff")) {
    const value = args[args.indexOf("--cutoff") + 1];
    if (!value) {
      console.error("FAIL --cutoff 뒤에 ISO 시각이 없음");
      process.exit(1);
    }
    await runSurvey(value);
  } else {
    console.error("FAIL --cutoff 없이 실행할 수 없음(T0 미고정 조사는 count 비교가 무의미). --self-test 또는 --cutoff <ISO 시각>");
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(`FAIL ${(err as Error).message ?? err}`);
  process.exit(1);
});
