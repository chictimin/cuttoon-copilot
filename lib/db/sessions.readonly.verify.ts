// spec-263 #10 GET·Export 전후 동일 검증(verify-commands-263 rev10).
// 실행: npx tsx --conditions=react-server lib/db/sessions.readonly.verify.ts
//
// 명령이 NODE_ENV를 설정하지 않으므로 client.ts 평가 전에 여기서 "test"로
// 설정한다(process.env.NODE_ENV는 읽기 전용 선언이라 인덱스로 우회).
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
// lib/render/export.ts → lib/asset-store.ts가 모듈 최상위에서 SUPABASE_URL·
// SUPABASE_SERVICE_ROLE_KEY를 요구한다. 실키·실DB를 쓰지 않으므로(가짜 클라이언트 +
// fetch stub) 더미 값으로 모듈 평가만 통과시킨다. 네트워크는 아래 stub이 막는다.
{
  const env = process.env as Record<string, string | undefined>;
  env.SUPABASE_URL ??= "http://127.0.0.1:0";
  env.SUPABASE_SERVICE_ROLE_KEY ??= "verify-dummy-key";
}

type Board = Record<string, unknown>;
type Cut = Record<string, unknown>;

const SHOTS = ["closeup", "full", "waist", "wide"];
const ANGLES = ["eye", "eye", "eye", "low"];
const POSITIONS = ["top_left", "top_right", "bottom_left", "bottom_right"];
const BEATS = ["hook", "problem", "solution", "cta"];

function makeCut(i: number, beat: string, caption: string): Cut {
  return {
    cut_index: i,
    narrative_beat: beat,
    shot_type: SHOTS[i - 1],
    camera_angle: ANGLES[i - 1],
    characters_in_frame: [
      { character_id: "a", expression: "neutral", pose: "stand" },
    ],
    caption: { text: caption, position: POSITIONS[i - 1], bubble_type: "rounded" },
    generated_image: null,
    cta_override: null,
  };
}

function makeBoard(captionPrefix: string): Board {
  return {
    storyboard_version: "1.0",
    subject: "소재",
    cast: [{ character_id: "a", role: "protagonist", description: "주인공" }],
    cuts: BEATS.map((b, k) => makeCut(k + 1, b, `${captionPrefix}${k + 1}`)),
    cta_strength: "clear",
  };
}

function cutsOf(b: Board): Cut[] {
  return b.cuts as Cut[];
}

function cloneBoard(b: Board): Board {
  return JSON.parse(JSON.stringify(b)) as Board;
}

// 키 순서에 무관한 deep-equal용 정규 직렬화.
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const r = v as Record<string, unknown>;
    return `{${Object.keys(r)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(r[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
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
  presets: FakeRow[] = [];

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
    const all =
      this.table === "sessions"
        ? this.db.sessions
        : this.table === "presets"
          ? this.db.presets
          : this.db.sessionVersions;
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
      if (this.table === "session_versions") {
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
        return { data: made, error: null };
      }
      return { data: null, error: { message: `insert 미지원 테이블 ${this.table}` } };
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
  const sessionRoute = await import("../../app/api/session/route");
  const exportRoute = await import("../../app/api/session/export/route");
  const versionRoute = await import("../../app/api/session/version/route");

  const db = new FakeDb();
  setTestDbClient(db as unknown as import("@supabase/supabase-js").SupabaseClient);
  // 모듈 평가 시 asset-store의 드리프트 감시(getBucket 1회 — 위 stub이 차단하고
  // 경고만 남김, 실네트워크 0)가 계수기에 먼저 찍힌다. 본문(GET·Export·저장) 측정을
  // 위해 매크로태스크 1회로 적재된 호출을 비운 뒤 0으로 둔다.
  await new Promise<void>((r) => setTimeout(r, 0));
  fetchCalls = 0;

  async function getSession(
    id: string
  ): Promise<{ status: number; json: unknown }> {
    const res = (await sessionRoute.GET(
      new Request(`http://localhost/api/session?id=${id}`)
    )) as Response;
    return { status: res.status, json: (await res.json()) as unknown };
  }

  async function getExport(id: string): Promise<{ status: number; body: string }> {
    const res = (await exportRoute.GET(
      new Request(`http://localhost/api/session/export?id=${id}`)
    )) as Response;
    return { status: res.status, body: await res.text() };
  }

  // 3세션 fixture(UUID 형식 id). generated_image는 전부 null.
  const S1 = "44444444-4444-4444-4444-444444444444";
  const S2 = "55555555-5555-5555-5555-555555555555";
  const S3 = "66666666-6666-6666-6666-666666666666";
  db.seedSession(S1);
  db.seedVersion(S1, 1, makeBoard("S1대사"));
  db.seedSession(S2);
  db.seedVersion(S2, 1, makeBoard("S2대사"));
  db.seedSession(S3);
  db.seedVersion(S3, 1, makeBoard("S3대사"));
  const s3v2 = makeBoard("S3대사");
  ((cutsOf(s3v2)[0].caption as Cut) as Cut).text = "S3고친대사";
  db.seedVersion(S3, 2, s3v2);

  // 스냅샷: 3세션 각각 GET 200 + Export 상태·JSON 본문 기록.
  const snapGet: Record<string, unknown> = {};
  const snapExport: Record<string, { status: number; body: string }> = {};
  for (const sid of [S1, S2, S3]) {
    const g = await getSession(sid);
    check(`RO-스냅샷GET200 ${sid.slice(0, 8)}`, g.status === 200, g);
    snapGet[sid] = g.json;
    const e0 = await getExport(sid);
    // 이미지 스텁(null)이라 Export는 409 "내보낼 이미지가 없습니다" 경로.
    check(`RO-스냅샷Export409 ${sid.slice(0, 8)}`, e0.status === 409, {
      status: e0.status,
      body: e0.body.slice(0, 120),
    });
    snapExport[sid] = e0;
  }

  // S1에만 caption 정상 편집 저장 1회 (→ 200 version+1).
  // GET 응답은 { sessionId, projectId, presetId, version, storyboard } 형태라
  // 편집·비교 대상 보드는 .storyboard에서 꺼낸다.
  const s1base = (snapGet[S1] as Record<string, unknown>).storyboard as Board;
  const s1v2 = cloneBoard(s1base);
  ((cutsOf(s1v2)[1].caption as Cut) as Cut).text = "S1고친대사";
  const saved = (await versionRoute.POST(
    new Request("http://localhost/api/session/version", {
      method: "POST",
      body: JSON.stringify({ sessionId: S1, storyboard: s1v2 }),
    })
  )) as Response;
  const savedJson = (await saved.json()) as Record<string, unknown>;
  check("RO-S1저장200", saved.status === 200 && savedJson.version === 2, {
    status: saved.status,
    json: savedJson,
  });

  // S1 GET → 200 + 제출 보드와 deep-equal.
  const s1after = await getSession(S1);
  check(
    "RO-저장후조회일치",
    s1after.status === 200 &&
      stable((s1after.json as Record<string, unknown>).storyboard) ===
        stable(s1v2),
    { status: s1after.status }
  );

  // S2·S3 GET → 200 + 스냅샷과 deep-equal.
  for (const sid of [S2, S3]) {
    const g = await getSession(sid);
    check(`RO-미변경2세션동일 ${sid.slice(0, 8)}`, g.status === 200 && stable(g.json) === stable(snapGet[sid]), {
      status: g.status,
    });
  }
  if (bad === 0) console.log("ok   RO-미변경2세션동일");

  // 3세션 Export → 상태·JSON 본문이 스냅샷과 동일.
  let exportSame = true;
  for (const sid of [S1, S2, S3]) {
    const e = await getExport(sid);
    const s = snapExport[sid];
    if (e.status !== s.status || e.body !== s.body) {
      exportSame = false;
      console.error(`FAIL RO-Export개별 ${sid.slice(0, 8)} — ${e.status} ${e.body.slice(0, 200)}`);
    }
  }
  check("RO-Export동일3", exportSame);

  check("RO-no-real-network", fetchCalls === 0);
  setTestDbClient(null);

  if (bad > 0) {
    console.error(`263-RO ${bad}건 실패`);
    process.exit(1);
  }
  console.log("OK 263-RO");
}

main().catch((e) => {
  console.error(`FAIL driver — ${String(e).slice(0, 200)}`);
  process.exit(1);
});

// 모듈 스코프 선언 — 같은 디렉토리의 다른 *.verify.ts와 전역 타입 충돌 방지.
// 런타임 영향 없음.
export {};
