// spec-263 P1-b 검증(verify-commands-263 #4).
// 실행: npx tsx lib/db/sessions.protection.verify.ts
//
// 두 층으로 돈다. lib/db/client.ts가 "server-only"를 import해서 tsx 기본 조건에서
// sessions.ts·route.ts를 import하면 평가 시점에 throw되므로(조건 없이는
// --conditions=react-server 필요, 실측 확인), 순수·정적 행은 부모에서,
// 실코드 경로(실제 saveSessionVersion·revertSession·실제 route POST) 행은
// 같은 파일의 자식 프로세스(npx tsx --conditions=react-server, 실DB·외부
// fetch 없이 가짜 클라이언트 주입)에서 돈다. 하네스 명령은 그대로다.
//
// 모의 재구현(MockRepo)은 실경로 검사로 대체했다 — 아래 경합·revert 행이
// 실제 helper·route를 가짜 DB에 붙여 확인한다.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  findNewViolations,
} from "../../app/api/session/validate";

type Board = Record<string, unknown>;
type Cut = Record<string, unknown>;

// --- fixture ---
const SHOTS = ["closeup", "full", "waist", "wide"];
const ANGLES = ["eye", "eye", "eye", "low"];
const POSITIONS = ["top_left", "top_right", "bottom_left", "bottom_right"];
const BEATS = ["hook", "problem", "solution", "cta"];

function cut(i: number, beat: string, frameIds: string[]): Cut {
  return {
    cut_index: i,
    narrative_beat: beat,
    shot_type: SHOTS[i - 1],
    camera_angle: ANGLES[i - 1],
    characters_in_frame: frameIds.map((id) => ({
      character_id: id,
      expression: "neutral",
      pose: "stand",
    })),
    caption: { text: `대사${i}`, position: POSITIONS[i - 1], bubble_type: "rounded" },
    generated_image: null,
    cta_override: null,
  };
}

function validBoard(): Board {
  return {
    storyboard_version: "1.0",
    subject: "소재",
    cast: [{ character_id: "a", role: "protagonist", description: "주인공" }],
    cuts: BEATS.map((b, k) => cut(k + 1, b, ["a"])),
    cta_strength: "clear",
  };
}

function cutsOf(b: Board): Cut[] {
  return b.cuts as Cut[];
}

function clone(b: Board): Board {
  return JSON.parse(JSON.stringify(b)) as Board;
}

function withCastAB(b: Board): Board {
  b.cast = [
    { character_id: "a", role: "protagonist", description: "주인공" },
    { character_id: "b", role: "supporting", description: "조연" },
  ];
  return b;
}

// --- 가짜 Supabase 클라이언트(실제로 쓰는 체인만) ---
interface FakeRow {
  [key: string]: unknown;
}

interface QueryError {
  code?: string;
  message: string;
}

interface QueryResult {
  data: unknown;
  error: QueryError | null;
}

class FakeDb {
  sessions: FakeRow[] = [];
  sessionVersions: FakeRow[] = [];
  failNextVersionInsert: QueryError | null = null;
  versionInserts = 0;
  sessionUpdates = 0;
  sessionInserts = 0;
  nextId = 1;

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  seedSession(id: string, subject = "소재"): void {
    this.sessions.push({
      id,
      project_id: "p1",
      preset_id: "pr1",
      subject,
      created_at: "2026-10-01T00:00:00Z",
    });
  }

  seedVersion(sessionId: string, version: number, storyboard: Board): void {
    this.sessionVersions.push({
      session_id: sessionId,
      version,
      storyboard,
      created_at: "2026-10-01T00:00:00Z",
    });
  }
}

class FakeQuery {
  private filters: Array<(r: FakeRow) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private insertRows: FakeRow[] | null = null;
  private updateVals: FakeRow | null = null;

  constructor(
    private db: FakeDb,
    private table: string
  ) {}

  select(): this {
    return this;
  }

  insert(rows: FakeRow | FakeRow[]): this {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(vals: FakeRow): this {
    this.updateVals = vals;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private rows(): FakeRow[] {
    const all = this.table === "sessions" ? this.db.sessions : this.db.sessionVersions;
    let out = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol !== null) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      out = [...out].sort((a, b) => {
        const x = a[col];
        const y = b[col];
        if (x === y) return 0;
        if (typeof x === "number" && typeof y === "number") return asc ? x - y : y - x;
        return asc ? String(x) < String(y) ? -1 : 1 : String(x) < String(y) ? 1 : -1;
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  private execute(): QueryResult {
    if (this.insertRows !== null) {
      if (this.table === "sessions") {
        const made = this.insertRows.map((r) => ({
          ...r,
          id: `mock-session-${this.db.nextId++}`,
          subject: r.subject ?? "",
          created_at: "2026-10-06T00:00:00Z",
        }));
        this.db.sessions.push(...made);
        this.db.sessionInserts++;
        return { data: made, error: null };
      }
      if (this.db.failNextVersionInsert !== null) {
        const err = this.db.failNextVersionInsert;
        this.db.failNextVersionInsert = null;
        return { data: null, error: err };
      }
      for (const r of this.insertRows) {
        const dup = this.db.sessionVersions.some(
          (v) => v.session_id === r.session_id && v.version === r.version
        );
        if (dup) {
          return { data: null, error: { code: "23505", message: "duplicate key value" } };
        }
      }
      const made = this.insertRows.map((r) => ({
        ...r,
        created_at: "2026-10-06T00:00:00Z",
      }));
      this.db.sessionVersions.push(...made);
      this.db.versionInserts++;
      return { data: made, error: null };
    }
    if (this.updateVals !== null) {
      for (const r of this.rows()) Object.assign(r, this.updateVals);
      this.db.sessionUpdates++;
      return { data: null, error: null };
    }
    return { data: this.rows(), error: null };
  }

  async maybeSingle(): Promise<QueryResult> {
    const r = this.execute();
    const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    return { data, error: r.error };
  }

  async single(): Promise<QueryResult> {
    const r = this.execute();
    const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    if (r.error) return { data: null, error: r.error };
    if (data === null || data === undefined)
      return { data: null, error: { message: "no rows" } };
    return { data, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((v: QueryResult) => TResult1) | null,
    onrejected?: ((e: unknown) => TResult2) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

// --- 검사 유틸 ---
let bad = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    bad++;
    console.error(
      `FAIL ${name}${detail === undefined ? "" : " — " + JSON.stringify(detail).slice(0, 300)}`
    );
  }
}

// --- 부모: 정적 행 + 자식 실행 ---
function runStatic(): void {
  const markers = [
    "findNewViolations",
    "buildStoryboardJudge",
    "demoCacheValues",
    "StoryboardProtection",
    "invalid_storyboard",
  ];
  const exportSrc = readFileSync("app/api/session/export/route.ts", "utf8");
  const routeSrc = readFileSync("app/api/session/route.ts", "utf8");
  const getSrc = routeSrc.slice(routeSrc.indexOf("export async function GET"));
  check(
    "Export 판정배선 없음",
    markers.every((m) => !exportSrc.includes(m)) && getSrc.length > 0
  );
  check("GET 판정배선 없음", markers.every((m) => !getSrc.includes(m)));

  const sessionsSrc = readFileSync("lib/db/sessions.ts", "utf8");
  const versionSrc = readFileSync("app/api/session/version/route.ts", "utf8");
  const revertSrc = readFileSync("app/api/session/revert/route.ts", "utf8");
  const validateSrc = readFileSync("app/api/session/validate.ts", "utf8");
  const clientSrc = readFileSync("lib/db/client.ts", "utf8");
  check(
    "배선 sessions",
    sessionsSrc.includes("judge: StoryboardJudge") &&
      sessionsSrc.includes("23505") &&
      sessionsSrc.includes("StoryboardProtectionError") &&
      sessionsSrc.includes("invalid_storyboard")
  );
  check(
    "배선 version",
    versionSrc.includes("buildStoryboardJudge") &&
      versionSrc.includes("loadDemoCacheValues") &&
      versionSrc.includes("version_conflict") &&
      versionSrc.includes("409")
  );
  check(
    "배선 revert",
    revertSrc.includes("buildStoryboardJudge") &&
      revertSrc.includes("invalid_storyboard") &&
      revertSrc.includes("invalid_subject_tags")
  );
  check(
    "배선 validate",
    validateSrc.includes("manifestImageRefs") &&
      validateSrc.includes("findNewViolations") &&
      validateSrc.includes("projectViolationBasis")
  );
  check(
    "배선 client 주입점",
    clientSrc.includes("setTestDbClient") && clientSrc.includes('NODE_ENV !== "test"')
  );
}

// --- 자식: 실코드 경로 행 ---
async function runRealPath(): Promise<void> {
  let fetchCalls = 0;
  (globalThis as Record<string, unknown>).fetch = () => {
    fetchCalls++;
    throw new Error("network blocked in verify");
  };

  const { setTestDbClient } = await import("./client");
  const sessionRoute = await import("../../app/api/session/route");
  const versionRoute = await import("../../app/api/session/version/route");
  const revertRoute = await import("../../app/api/session/revert/route");

  const inject = (db: FakeDb): void =>
    setTestDbClient(db as unknown as import("@supabase/supabase-js").SupabaseClient);

  async function postSession(body: unknown): Promise<{ status: number; json: unknown }> {
    const res = (await sessionRoute.POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        body: JSON.stringify(body),
      })
    )) as Response;
    return { status: res.status, json: (await res.json()) as unknown };
  }

  async function postVersion(body: unknown): Promise<{ status: number; json: unknown }> {
    const res = (await versionRoute.POST(
      new Request("http://localhost/api/session/version", {
        method: "POST",
        body: JSON.stringify(body),
      })
    )) as Response;
    return { status: res.status, json: (await res.json()) as unknown };
  }

  async function postRevert(body: unknown): Promise<{ status: number; json: unknown }> {
    const res = (await revertRoute.POST(
      new Request("http://localhost/api/session/revert", {
        method: "POST",
        body: JSON.stringify(body),
      })
    )) as Response;
    return { status: res.status, json: (await res.json()) as unknown };
  }

  const SID = "11111111-1111-1111-1111-111111111111";

  // 새 세션 위반 400 (실제 POST)
  {
    const db = new FakeDb();
    inject(db);
    const violated = validBoard();
    (cutsOf(violated)[0] as Cut).generated_image = "stub-x";
    const r = await postSession({ projectId: "p1", presetId: "pr1", storyboard: violated });
    check("POST새세션위반400", r.status === 400, r);
  }

  // 새 세션 asset:// 표지 회귀 200 (실제 POST)
  {
    const db = new FakeDb();
    inject(db);
    const b = validBoard();
    for (const c of cutsOf(b)) c.generated_image = "asset://cover-1.png";
    const r = await postSession({ projectId: "p1", presetId: "pr1", storyboard: b });
    const j = r.json as Record<string, unknown>;
    check("POST새세션asset200", r.status === 200 && j.version === 1, r);
  }

  // version 보호 통과 200 (실제 route, 기존 위반 없음 + caption 편집)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, validBoard());
    const v2 = validBoard();
    ((cutsOf(v2)[1].caption as Cut) as Cut).text = "고친 대사";
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("version보호통과200", r.status === 200 && j.version === 2, r);
  }

  // version 보호 거부 5종 (실제 route, 400)
  {
    const cases: Array<[string, (v1: Board, v2: Board) => void]> = [
      [
        "값악화",
        (v1, v2) => {
          (cutsOf(v1)[0] as Cut).generated_image = "stub-x";
          (cutsOf(v2)[0] as Cut).generated_image = "https://evil.example/x.png";
        },
      ],
      [
        "개수악화",
        (v1, v2) => {
          v1.cuts = cutsOf(v1).slice(0, 3);
          v2.cuts = cutsOf(v2).slice(0, 1);
        },
      ],
      [
        "다른오타교체",
        (v1, v2) => {
          (cutsOf(v1)[0] as Cut).narrative_beat = "problm";
          (cutsOf(v2)[0] as Cut).narrative_beat = "probelm";
        },
      ],
      [
        "위치교환",
        (v1, v2) => {
          cutsOf(v1)[1].cut_index = 1;
          const c = cutsOf(v2);
          c[1].cut_index = 1;
          const tmp = c[0];
          c[0] = c[1];
          c[1] = tmp;
        },
      ],
      [
        "고친뒤재유입",
        (v1, v2) => {
          (cutsOf(v1)[0] as Cut).narrative_beat = "problm";
          (cutsOf(v2)[0] as Cut).narrative_beat = "problem";
          (cutsOf(v2)[1] as Cut).shot_type = "초접사";
        },
      ],
    ];
    for (const [name, mutate] of cases) {
      const db = new FakeDb();
      inject(db);
      db.seedSession(SID);
      const v1 = validBoard();
      const v2 = clone(validBoard());
      mutate(v1, v2);
      db.seedVersion(SID, 1, v1);
      const r = await postVersion({ sessionId: SID, storyboard: v2 });
      check(`version보호거부${name}400`, r.status === 400, r);
    }
  }

  // frame 이동·교환 400, id 유지 caption 편집 200 (실제 route)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const v1 = withCastAB(validBoard());
    (((cutsOf(v1)[0] as Cut).characters_in_frame as Cut[])[0] as Cut).expression = "smil";
    db.seedVersion(SID, 1, v1);
    const moved = clone(v1);
    (((cutsOf(moved)[0] as Cut).characters_in_frame as Cut[])[0] as Cut).character_id = "b";
    const r1 = await postVersion({ sessionId: SID, storyboard: moved });
    check("version frame인물이동400", r1.status === 400, r1);

    const swapped = clone(v1);
    (cutsOf(swapped)[0] as Cut).characters_in_frame = [
      { character_id: "b", expression: "smil", pose: "stand" },
      { character_id: "a", expression: "smile", pose: "stand" },
    ];
    // 교환 전 b가 준주연 2인 체제여야 하므로 2인 frame으로 v1을 맞춤
    const v1b = withCastAB(validBoard());
    (cutsOf(v1b)[0] as Cut).characters_in_frame = [
      { character_id: "a", expression: "smil", pose: "stand" },
      { character_id: "b", expression: "smile", pose: "stand" },
    ];
    const db2 = new FakeDb();
    inject(db2);
    db2.seedSession(SID);
    db2.seedVersion(SID, 1, v1b);
    const r2 = await postVersion({ sessionId: SID, storyboard: swapped });
    check("version frame교환400", r2.status === 400, r2);

    const edited = clone(v1);
    ((cutsOf(edited)[0].caption as Cut) as Cut).text = "고친 대사";
    ((cutsOf(edited)[0].caption as Cut) as Cut).position = "center";
    const db3 = new FakeDb();
    inject(db3);
    db3.seedSession(SID);
    db3.seedVersion(SID, 1, v1);
    const r3 = await postVersion({ sessionId: SID, storyboard: edited });
    check("version frame유지caption200", r3.status === 200, r3);
  }

  // 깨진 cut_index caption 편집 400 (실제 route, 형태 단계에서 거부)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, validBoard());
    const v2 = validBoard();
    cutsOf(v2)[1].cut_index = 2;
    cutsOf(v2)[0].cut_index = 2;
    cutsOf(v2)[2].cut_index = 3;
    cutsOf(v2)[3].cut_index = 4;
    ((cutsOf(v2)[2].caption as Cut) as Cut).text = "고친 대사";
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    check("version깨진cut_index400", r.status === 400, r);
  }

  // 깨진 character_id caption 편집 통과 유지 (실제 route, 200)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const v1 = validBoard();
    v1.cast = [
      { character_id: "a", role: "protagonist", description: "d" },
      { character_id: "a", role: "supporting", description: "e" },
    ];
    db.seedVersion(SID, 1, v1);
    const v2 = clone(v1);
    ((cutsOf(v2)[2].caption as Cut) as Cut).text = "고친 대사";
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    check("version깨진character_id200", r.status === 200, r);
  }

  // 경합: 같은 baseline 두 저장 → 200 + 409 version_conflict, 판정 안 된 버전 0
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, validBoard());
    const vA = validBoard();
    ((cutsOf(vA)[1].caption as Cut) as Cut).text = "A";
    const r1 = await postVersion({ sessionId: SID, storyboard: vA });
    db.failNextVersionInsert = { code: "23505", message: "duplicate key value" };
    const vB = validBoard();
    ((cutsOf(vB)[1].caption as Cut) as Cut).text = "B";
    const r2 = await postVersion({ sessionId: SID, storyboard: vB });
    const j2 = r2.json as Record<string, unknown>;
    const chainOk = db.sessionVersions
      .sort((a, b) => (a.version as number) - (b.version as number))
      .every((v, i, arr) =>
        i === 0
          ? true
          : findNewViolations(v.storyboard, arr[i - 1].storyboard).length === 0
      );
    check(
      "경합순차매핑200+409+판정안된버전0",
      r1.status === 200 &&
        r2.status === 409 &&
        j2.code === "version_conflict" &&
        db.sessionVersions.length === 2 &&
        chainOk
    );
  }

  // revert 위반 이력 409 + 쓰기 0 (실제 route)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const previous = validBoard();
    (cutsOf(previous)[0] as Cut).generated_image = "stub-x";
    db.seedVersion(SID, 1, previous);
    db.seedVersion(SID, 2, validBoard());
    const before = { inserts: db.versionInserts, writes: db.sessionUpdates };
    const r = await postRevert({ sessionId: SID });
    const j = r.json as Record<string, unknown>;
    check(
      "revert위반이력409쓰기0",
      r.status === 409 &&
        j.code === "invalid_storyboard" &&
        db.versionInserts === before.inserts &&
        db.sessionUpdates === before.writes
    );
  }

  // revert subject_tags 우선 409 (실제 route)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const previous = validBoard();
    (cutsOf(previous)[0] as Cut).generated_image = "stub-x";
    previous.subject_tags = [{ raw: "태그" }];
    db.seedVersion(SID, 1, previous);
    db.seedVersion(SID, 2, validBoard());
    const r = await postRevert({ sessionId: SID });
    check(
      "revert tags우선409",
      r.status === 409 &&
        (r.json as Record<string, unknown>).error ===
          "되돌릴 버전의 소재 태그가 형식에 맞지 않습니다" &&
        !("code" in (r.json as Record<string, unknown>)),
      r
    );
  }

  // revert 정상 200 (실제 route)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, validBoard());
    db.seedVersion(SID, 2, validBoard());
    const r = await postRevert({ sessionId: SID });
    const j = r.json as Record<string, unknown>;
    check("revert정상200", r.status === 200 && j.version === 3, r);
  }

  check("fetch차단", fetchCalls === 0);
  setTestDbClient(null);
}

if (process.env.P0_VERIFY_REALPATH === "1") {
  runRealPath().then(() => {
    if (bad > 0) {
      console.error(`263-F2 ${bad}건 실패`);
      process.exit(1);
    }
    console.log("OK 263-F2");
  });
} else {
  runStatic();
  try {
    const out = execFileSync(
      "npx",
      ["tsx", "--conditions=react-server", "lib/db/sessions.protection.verify.ts"],
      {
        env: { ...process.env, P0_VERIFY_REALPATH: "1", NODE_ENV: "test" },
        encoding: "utf8",
        timeout: 120000,
      }
    );
    process.stdout.write(out);
  } catch (e) {
    bad++;
    const err = e as { stdout?: string; message?: string };
    if (typeof err.stdout === "string") process.stdout.write(err.stdout);
    console.error(`FAIL 자식실행 — ${String(err.message ?? e).slice(0, 200)}`);
  }
  if (bad > 0) {
    console.error(`263-F2 ${bad}건 실패`);
    process.exit(1);
  }
}
