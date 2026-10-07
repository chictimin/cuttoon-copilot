// spec-263 #8 실라우트 검증(verify-commands-263 rev10).
// 실행: npx tsx --conditions=react-server lib/db/sessions.route.verify.ts
//
// 명령이 NODE_ENV를 설정하지 않으므로 client.ts 평가 전에 여기서 "test"로
// 설정한다(process.env.NODE_ENV는 읽기 전용 선언이라 인덱스로 우회).
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

type Board = Record<string, unknown>;
type Cut = Record<string, unknown>;

const SHOTS = ["closeup", "full", "waist", "wide"];
const ANGLES = ["eye", "eye", "eye", "low"];
const POSITIONS = ["top_left", "top_right", "bottom_left", "bottom_right"];
const BEATS = ["hook", "problem", "solution", "cta"];

function makeCut(i: number, beat: string): Cut {
  return {
    cut_index: i,
    narrative_beat: beat,
    shot_type: SHOTS[i - 1],
    camera_angle: ANGLES[i - 1],
    characters_in_frame: [
      { character_id: "a", expression: "neutral", pose: "stand" },
    ],
    caption: { text: `대사${i}`, position: POSITIONS[i - 1], bubble_type: "rounded" },
    generated_image: null,
    cta_override: null,
  };
}

function makeBoard(): Board {
  return {
    storyboard_version: "1.0",
    subject: "소재",
    cast: [{ character_id: "a", role: "protagonist", description: "주인공" }],
    cuts: BEATS.map((b, k) => makeCut(k + 1, b)),
    cta_strength: "clear",
  };
}

function cutsOf(b: Board): Cut[] {
  return b.cuts as Cut[];
}

function cloneBoard(b: Board): Board {
  return JSON.parse(JSON.stringify(b)) as Board;
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
  failNextVersionInsert: QueryError | null = null;
  nextId = 1;
  // R6 실제 동시 경합용: 최신 조회 장벽 + 관찰 계수기. R6 블록에서만 세팅한다.
  raceGate: {
    needed: number;
    arrived: number;
    snapshot: FakeRow[] | null;
    release: Promise<void>;
    releaseFn: () => void;
  } | null = null;
  latestReadVersions: number[] = [];
  versionInsertSuccess = 0;

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  seedSession(id: string): void {
    this.sessions.push({
      id,
      project_id: "p1",
      preset_id: "pr1",
      subject: "소재",
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
    return this.rowsFrom(all);
  }

  private rowsFrom(all: FakeRow[]): FakeRow[] {
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
          subject: r.subject ?? "",
          created_at: "2026-10-06T00:00:00Z",
        }));
        this.db.sessions.push(...made);
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
      this.db.versionInsertSuccess++;
      return { data: made, error: null };
    }
    if (this.updateVals !== null) {
      for (const r of this.rows()) Object.assign(r, this.updateVals);
      return { data: null, error: null };
    }
    return { data: this.rows(), error: null };
  }

  // R6 장벽 대상: 최신 버전 조회 1건(version 내림차순 limit 1).
  private isLatestLookup(): boolean {
    return (
      this.table === "session_versions" &&
      this.insertRows === null &&
      this.updateVals === null &&
      this.orderCol === "version" &&
      this.orderAsc === false &&
      this.limitN === 1
    );
  }

  // 장벽 통과 최신 조회: 두 요청이 모두 도착해야 해제되고, 둘 다 장벽 시점의
  // 같은 스냅샷을 본다. 읽은 baseline version을 기록한다.
  private async gatedLatest(): Promise<QueryResult> {
    const gate = this.db.raceGate!;
    gate.arrived++;
    if (gate.arrived >= gate.needed) {
      gate.snapshot = this.db.sessionVersions.map((r) => ({ ...r }));
      gate.releaseFn();
    } else {
      await gate.release;
    }
    const first = this.rowsFrom(gate.snapshot ?? [])[0] ?? null;
    if (first !== null && typeof first.version === "number") {
      this.db.latestReadVersions.push(first.version);
    }
    return { data: first, error: null };
  }

  private useGate(): boolean {
    return this.db.raceGate !== null && this.isLatestLookup();
  }

  async maybeSingle(): Promise<QueryResult> {
    if (this.useGate()) return this.gatedLatest();
    const r = this.execute();
    const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    return { data, error: r.error };
  }

  async single(): Promise<QueryResult> {
    if (this.useGate()) return this.gatedLatest();
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
    if (this.useGate()) return this.gatedLatest().then(onfulfilled, onrejected);
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

function makeRaceGate(needed: number): NonNullable<FakeDb["raceGate"]> {
  let releaseFn: () => void = () => {};
  const release = new Promise<void>((res) => {
    releaseFn = res;
  });
  return { needed, arrived: 0, snapshot: null, release, releaseFn };
}

async function main(): Promise<void> {
  let bad = 0;
  const check = (name: string, cond: boolean, detail?: unknown): void => {
    if (cond) {
      console.log(`ok   ${name}`);
    } else {
      bad++;
      console.error(
        `FAIL ${name}${detail === undefined ? "" : " — " + JSON.stringify(detail).slice(0, 300)}`
      );
    }
  };

  let fetchCalls = 0;
  (globalThis as Record<string, unknown>).fetch = () => {
    fetchCalls++;
    throw new Error("network blocked in verify");
  };

  const { setTestDbClient } = await import("./client");
  const versionRoute = await import("../../app/api/session/version/route");

  const inject = (db: FakeDb): void =>
    setTestDbClient(db as unknown as import("@supabase/supabase-js").SupabaseClient);

  async function postVersion(body: unknown): Promise<{ status: number; json: unknown }> {
    const res = (await versionRoute.POST(
      new Request("http://localhost/api/session/version", {
        method: "POST",
        body: JSON.stringify(body),
      })
    )) as Response;
    return { status: res.status, json: (await res.json()) as unknown };
  }

  const SID = "22222222-2222-2222-2222-222222222222";

  // R1 정상 편집 200 version+1
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, makeBoard());
    const v2 = makeBoard();
    ((cutsOf(v2)[1].caption as Cut) as Cut).text = "고친 대사";
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("R1 정상편집200", r.status === 200 && j.version === 2, r);
  }

  // R2 새 위반 400 invalid_storyboard
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const v1 = makeBoard();
    (cutsOf(v1)[0] as Cut).generated_image = "stub-x";
    db.seedVersion(SID, 1, v1);
    const v2 = cloneBoard(v1);
    (cutsOf(v2)[0] as Cut).generated_image = "https://evil.example/x.png";
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    const j = r.json as Record<string, unknown>;
    check("R2 새위반400", r.status === 400 && j.code === "invalid_storyboard", r);
  }

  // R3 순차 매핑 409 version_conflict (순차 await + 강제 23505 주입 =
  // 오류 매핑·재시도 없음 검사, 동시 경합 아님)
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, makeBoard());
    const vA = makeBoard();
    ((cutsOf(vA)[1].caption as Cut) as Cut).text = "A";
    const r1 = await postVersion({ sessionId: SID, storyboard: vA });
    db.failNextVersionInsert = { code: "23505", message: "duplicate key value" };
    const vB = makeBoard();
    ((cutsOf(vB)[1].caption as Cut) as Cut).text = "B";
    const r2 = await postVersion({ sessionId: SID, storyboard: vB });
    const j2 = r2.json as Record<string, unknown>;
    check(
      "R3 순차매핑409",
      r1.status === 200 && r2.status === 409 && j2.code === "version_conflict",
      { r1, r2 }
    );
  }

  // R6 실제 동시 경합: 같은 baseline 장벽 + Promise.all 동시 POST.
  // failNextVersionInsert 같은 강제 주입 없음 — 23505는 저장된 중복에서만 난다.
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, makeBoard());
    db.raceGate = makeRaceGate(2);
    const vA = makeBoard();
    ((cutsOf(vA)[1].caption as Cut) as Cut).text = "A";
    const vB = makeBoard();
    ((cutsOf(vB)[1].caption as Cut) as Cut).text = "B";
    const [rA, rB] = await Promise.all([
      postVersion({ sessionId: SID, storyboard: vA }),
      postVersion({ sessionId: SID, storyboard: vB }),
    ]);
    db.raceGate = null;
    const jA = rA.json as Record<string, unknown>;
    const jB = rB.json as Record<string, unknown>;
    const okPair =
      (rA.status === 200 && rB.status === 409 && jB.code === "version_conflict") ||
      (rB.status === 200 && rA.status === 409 && jA.code === "version_conflict");
    const maxVersion = db.sessionVersions.reduce(
      (m, v) => Math.max(m, v.version as number),
      0
    );
    check(
      "R6 동시경합200+409",
      okPair &&
        db.latestReadVersions.length === 2 &&
        db.latestReadVersions.every((v) => v === 1) &&
        db.versionInsertSuccess === 1 &&
        maxVersion === 2,
      { rA, rB, reads: db.latestReadVersions, inserts: db.versionInsertSuccess }
    );
  }

  // R4 미존재 404
  {
    const db = new FakeDb();
    inject(db);
    const r = await postVersion({
      sessionId: "33333333-3333-3333-3333-333333333333",
      storyboard: makeBoard(),
    });
    check("R4 미존재404", r.status === 404, r);
  }

  // R5 깨진 cut_index caption 편집 400
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, makeBoard());
    const v2 = makeBoard();
    cutsOf(v2)[0].cut_index = 2;
    cutsOf(v2)[1].cut_index = 2;
    cutsOf(v2)[2].cut_index = 3;
    cutsOf(v2)[3].cut_index = 4;
    ((cutsOf(v2)[2].caption as Cut) as Cut).text = "고친 대사";
    const r = await postVersion({ sessionId: SID, storyboard: v2 });
    check("R5 깨진cut_index400", r.status === 400, r);
  }

  check("no-real-network", fetchCalls === 0);
  setTestDbClient(null);

  if (bad > 0) {
    console.error(`263-R ${bad}건 실패`);
    process.exit(1);
  }
  console.log("OK 263-R");
}

main().catch((e) => {
  console.error(`FAIL driver — ${String(e).slice(0, 200)}`);
  process.exit(1);
});
