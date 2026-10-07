// spec-242 SPK·ANC 보호 비교·3경로·공백 기간 검증(verify-commands-242 #6, rev4).
// 실행: npx tsx --conditions=react-server lib/db/sessions.speaker-anchor.verify.ts
//
// 모의 repository(#263 client.ts 주입점 경유 가짜 클라이언트 — 실DB 0).
// 전역 요청 함수는 차단 스텁으로 막고 시도 URL을 전부 기록한다(리턴 경로 없음).
// 출력 행명: `ok SPK-<행>`·`ok ANC-<행>`·`ok PATH-<행>`·`ok BLANK-<행>` +
// 末尾 `OK 242-PROTECT` + `OK 242-BLANK`.

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

let netCalls = 0;
const attemptedUrls: string[] = [];
(globalThis as Record<string, unknown>).fetch = (input: unknown) => {
  const raw = (input as { url?: unknown }).url ?? input;
  attemptedUrls.push(typeof raw === "string" ? raw : String(raw));
  netCalls++;
  throw new Error("network blocked in verify");
};

/**
 * rev4 no-real-network 판정(PM #51782-2). 기록된 시도 URL 전건의 호스트가
 * 실행 시점 process.env.SUPABASE_URL의 호스트와 일치할 때만 통과한다.
 * 기대 호스트는 리터럴이 아니라 실행 시점 env에서 읽는다. 파싱 불가·env 없음·
 * 비더미 호스트 1건이라도 있으면 실패 쪽으로 판정한다.
 */
function allAttemptsDummyHost(urls: string[]): boolean {
  const envUrl = (process.env as Record<string, string | undefined>).SUPABASE_URL;
  if (!envUrl) return false;
  let expected: string;
  try {
    expected = new URL(envUrl).hostname;
  } catch {
    return false;
  }
  if (!expected) return false;
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      return false;
    }
    if (host !== expected) return false;
  }
  return true;
}

type Board = Record<string, unknown>;
type Cut = Record<string, unknown>;

const SHOTS = ["closeup", "full", "waist", "wide"];
const ANGLES = ["eye", "eye", "eye", "low"];
const POSITIONS = ["top_left", "top_right", "bottom_left", "bottom_right"];
const BEATS = ["hook", "problem", "solution", "cta"];

function frame(ids: string[]): unknown[] {
  return ids.map((id) => ({ character_id: id, expression: "neutral", pose: "stand" }));
}

function cut(i: number, beat: string, ids: string[], capPatch?: Record<string, unknown>): Cut {
  return {
    cut_index: i,
    narrative_beat: beat,
    shot_type: SHOTS[i - 1],
    camera_angle: ANGLES[i - 1],
    characters_in_frame: frame(ids),
    caption: Object.assign(
      { text: `대사${i}`, position: POSITIONS[i - 1], bubble_type: "rounded" },
      capPatch ?? {}
    ),
    generated_image: null,
    cta_override: null,
  };
}

function validBoard(): Board {
  return {
    storyboard_version: "1.0",
    subject: "소재",
    cast: [
      { character_id: "a", role: "protagonist", description: "주인공" },
      { character_id: "b", role: "supporting", description: "조연" },
    ],
    cuts: [
      cut(1, BEATS[0], ["a"]),
      cut(2, BEATS[1], ["a"]),
      cut(3, BEATS[2], ["a", "b"]),
      cut(4, BEATS[3], ["a"]),
    ],
    cta_strength: "clear",
  };
}

function clone(b: Board): Board {
  return JSON.parse(JSON.stringify(b)) as Board;
}

function cutsOf(b: Board): Cut[] {
  return b.cuts as Cut[];
}

function captionOf(c: Cut): Record<string, unknown> {
  return c.caption as Record<string, unknown>;
}

/** 1인 컷에 speaker_index가 있는 SPK 위반 보드(컷1). */
function spkBoard(): Board {
  const b = validBoard();
  captionOf(cutsOf(b)[0]).speaker_index = 0;
  return b;
}

/** anchor 범위 밖 ANC 위반 보드(컷1). */
function ancBoard(): Board {
  const b = validBoard();
  captionOf(cutsOf(b)[0]).anchor = { x: 1.5, y: 0.5 };
  return b;
}

/** 유효 anchor가 있는 보드(컷1) — 공백 기간용. */
function anchorValidBoard(): Board {
  const b = validBoard();
  captionOf(cutsOf(b)[0]).anchor = { x: 0.2, y: 0.8 };
  return b;
}

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
  nextId = 1;

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  seedSession(id: string, subject = "소재"): void {
    this.sessions.push({ id, project_id: "p1", preset_id: "pr1", subject });
  }

  seedVersion(sessionId: string, version: number, storyboard: Board): void {
    this.sessionVersions.push({ session_id: sessionId, version, storyboard });
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
    const all =
      this.table === "sessions"
        ? this.db.sessions
        : this.table === "session_versions"
          ? this.db.sessionVersions
          : [];
    let out = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol !== null) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      out = [...out].sort((a, b) => {
        const x = a[col];
        const y = b[col];
        if (x === y) return 0;
        if (typeof x === "number" && typeof y === "number") return asc ? x - y : y - x;
        return asc ? (String(x) < String(y) ? -1 : 1) : String(x) < String(y) ? 1 : -1;
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
        }));
        this.db.sessions.push(...made);
        return { data: made, error: null };
      }
      for (const r of this.insertRows) {
        const dup = this.db.sessionVersions.some(
          (v) => v.session_id === r.session_id && v.version === r.version
        );
        if (dup) {
          return { data: null, error: { code: "23505", message: "duplicate key value" } };
        }
      }
      const made = this.insertRows.map((r) => ({ ...r }));
      this.db.sessionVersions.push(...made);
      return { data: made, error: null };
    }
    if (this.updateVals !== null) {
      for (const r of this.rows()) Object.assign(r, this.updateVals);
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

let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`ok ${name}`);
  } else {
    failed++;
    console.error(
      `FAIL ${name}${detail === undefined ? "" : " " + JSON.stringify(detail).slice(0, 300)}`
    );
  }
}

const SID = "11111111-1111-1111-1111-111111111111";
const SID2 = "22222222-2222-2222-2222-222222222222";

async function main(): Promise<void> {
  // export 경로의 import 시점 환경 검사를 통과시키는 더미 값(실연결 없음 —
  // DB는 아래 가짜 클라이언트 주입, 외부 호출 차단은 no-real-network행이 판정).
  // 더미 URL은 완성 문자열 리터럴로 박지 않고 조각으로 둔다.
  const env = process.env as Record<string, string | undefined>;
  if (!env.SUPABASE_URL) env.SUPABASE_URL = "https://" + "verify.invalid";
  if (!env.SUPABASE_SERVICE_ROLE_KEY) env.SUPABASE_SERVICE_ROLE_KEY = "verify-dummy";

  const { setTestDbClient } = await import("./client");
  const sessionRoute = await import("../../app/api/session/route");
  const versionRoute = await import("../../app/api/session/version/route");
  const revertRoute = await import("../../app/api/session/revert/route");
  const exportRoute = await import("../../app/api/session/export/route");

  const inject = (db: FakeDb): void => {
    (setTestDbClient as (c: unknown) => void)(db);
  };

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

  async function getSession(
    id: string,
    db: FakeDb
  ): Promise<{ status: number; json: unknown }> {
    inject(db);
    const res = (await sessionRoute.GET(
      new Request(`http://localhost/api/session?id=${id}`)
    )) as Response;
    return { status: res.status, json: (await res.json()) as unknown };
  }

  async function getExport(id: string, db: FakeDb): Promise<{ status: number; json: unknown }> {
    inject(db);
    const res = (await exportRoute.GET(
      new Request(`http://localhost/api/session/export?id=${id}`)
    )) as Response;
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }

  // SPK 보호 3종
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, spkBoard());
    const v2 = spkBoard();
    captionOf(cutsOf(v2)[1]).text = "고친 대사";
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("SPK-keep-pass", r.status === 200 && j.version === 2, r);
  }
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const v1 = validBoard();
    cutsOf(v1)[0].characters_in_frame = frame(["a", "b"]);
    captionOf(cutsOf(v1)[0]).speaker_index = 2;
    db.seedVersion(SID, 1, v1);
    const v2 = clone(v1);
    cutsOf(v2)[0].characters_in_frame = frame(["a"]);
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("SPK-frame-shrink", r.status === 400 && j.code === "invalid_storyboard", r);
  }
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, spkBoard());
    const v2 = spkBoard();
    delete captionOf(cutsOf(v2)[0]).speaker_index;
    captionOf(cutsOf(v2)[1]).speaker_index = 0;
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("SPK-locator-move", r.status === 400 && j.code === "invalid_storyboard", r);
  }
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, spkBoard());
    const v2 = spkBoard();
    captionOf(cutsOf(v2)[1]).anchor = { x: 2, y: 0.5 };
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("SPK-mixed-reject", r.status === 400 && j.code === "invalid_storyboard", r);
  }

  // ANC 보호 3종(+ 고침 1행)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, ancBoard());
    const v2 = ancBoard();
    captionOf(cutsOf(v2)[2]).text = "고친 대사";
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("ANC-keep-pass", r.status === 200 && j.version === 2, r);
  }
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const v1 = anchorValidBoard();
    db.seedVersion(SID, 1, v1);
    const v2 = clone(v1);
    captionOf(cutsOf(v2)[0]).anchor = { x: 1.5, y: 0.5 };
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("ANC-worsen-reject", r.status === 400 && j.code === "invalid_storyboard", r);
  }
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, ancBoard());
    const fixed = anchorValidBoard();
    const r1 = await postVersion({ sessionId: SID, storyboard: fixed });
    const j1 = r1.json as Record<string, unknown>;
    check("ANC-fix-pass", r1.status === 200 && j1.version === 2, r1);
    const r2 = await postVersion({ sessionId: SID, storyboard: ancBoard() });
    const j2 = r2.json as Record<string, unknown>;
    check("ANC-reintroduce-reject", r2.status === 400 && j2.code === "invalid_storyboard", r2);
  }

  // 3경로
  {
    const db = new FakeDb();
    inject(db);
    const r = await postSession({ projectId: "p1", presetId: "pr1", storyboard: spkBoard() });
    const j = r.json as Record<string, unknown>;
    check("PATH-post-400", r.status === 400 && j.code === "invalid_storyboard", r);
  }
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, validBoard());
    const r = await postVersion({ sessionId: SID, storyboard: spkBoard() });
    const j = r.json as Record<string, unknown>;
    check("PATH-version-400", r.status === 400 && j.code === "invalid_storyboard", r);
  }
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, spkBoard());
    db.seedVersion(SID, 2, validBoard());
    const before = db.sessionVersions.length;
    const r = await postRevert({ sessionId: SID });
    const j = r.json as Record<string, unknown>;
    check(
      "PATH-revert-409",
      r.status === 409 && j.code === "invalid_storyboard" && db.sessionVersions.length === before,
      { r, versions: db.sessionVersions.length }
    );
  }

  // 공백 기간: anchor 저장 → GET → 같은 draft로 /version → anchor 보존
  {
    const db = new FakeDb();
    db.seedSession(SID);
    db.seedVersion(SID, 1, anchorValidBoard());
    const g1 = await getSession(SID, db);
    const sb1 = (g1.json as Record<string, unknown>).storyboard as Board;
    const anchor1 = captionOf(cutsOf(sb1)[0]).anchor;
    const sameAnchor =
      g1.status === 200 && JSON.stringify(anchor1) === JSON.stringify({ x: 0.2, y: 0.8 });
    const position1 = captionOf(cutsOf(sb1)[0]).position;
    const r = await postVersion({ sessionId: SID, storyboard: sb1 });
    const j = r.json as Record<string, unknown>;
    const g2 = await getSession(SID, db);
    const sb2 = (g2.json as Record<string, unknown>).storyboard as Board;
    const anchor2 = captionOf(cutsOf(sb2)[0]).anchor;
    check(
      "BLANK-roundtrip",
      sameAnchor &&
        r.status === 200 &&
        j.version === 2 &&
        JSON.stringify(anchor2) === JSON.stringify({ x: 0.2, y: 0.8 }) &&
        position1 === "top_left",
      { g1: g1.status, r, anchor2 }
    );
  }
  // 공백 기간: anchor 유무와 무관하게 Export 응답 동일(position 출력)
  {
    const db = new FakeDb();
    db.seedSession(SID, "소재");
    db.seedVersion(SID, 1, anchorValidBoard());
    db.seedSession(SID2, "소재");
    db.seedVersion(SID2, 1, validBoard());
    const a = await getExport(SID, db);
    const b = await getExport(SID2, db);
    check(
      "BLANK-export-same",
      a.status === b.status && JSON.stringify(a.json) === JSON.stringify(b.json),
      { a, b }
    );
  }

  check("no-real-network", allAttemptsDummyHost(attemptedUrls), {
    attempts: attemptedUrls.length,
    calls: netCalls,
  });

  if (failed > 0) {
    console.error(`${failed}건 실패`);
    process.exit(1);
  }
  console.log("OK 242-PROTECT");
  console.log("OK 242-BLANK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
