// spec-263-r1 R1-b 검증(verify-commands-1008-263r1b #5).
// 실행: npx tsx --conditions=react-server lib/db/sessions.xk.verify.ts
//
// 명령이 NODE_ENV를 설정하지 않으므로 client.ts 평가 전에 여기서 "test"로
// 설정한다(process.env.NODE_ENV는 읽기 전용 선언이라 인덱스로 우회).
// client.ts setTestDbClient 주입점 경유 가짜 클라이언트 — #263
// sessions.route.verify.ts·sessions.readonly.verify.ts의 모의 패턴을 재사용.
// tsx로 실행, 외부 fetch·실DB 금지. 전역 fetch는 차단 스텁 + 시도 횟수 기록.
// 화면 함수는 tsx import 방식만 쓰고 new Function 평가는 쓰지 않는다
// (assembleStoryboard·setCaptionSpeaker는 storyboard-assembly에서 import,
// EditorFlow updateAnchor·updateCaptionText는 React 훅 함수라 import 대신
// 아래 spread 의미 그대로의 지역 미러로 경유한다).
// mascot PATCH 본문은 손으로 만든 HTTP 본문이다 — base 화면에 해당 PATCH
// 호출 경로가 없어(leso 5절) 화면 경로 PASS로 표기하지 않는다.
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
// lib/render/compose.ts 체인(sharp·opentype) 모듈 평가용 더미 — 실DB·실키를
// 쓰지 않는다. 네트워크는 아래 fetch 스텁이 막는다.
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

function makeCut(i: number, beat: string): Cut {
  return {
    cut_index: i,
    narrative_beat: beat,
    shot_type: SHOTS[i - 1],
    camera_angle: ANGLES[i - 1],
    characters_in_frame: [{ character_id: "a", expression: "neutral", pose: "stand" }],
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

function captionOf(cut: Cut): Cut {
  return cut.caption as Cut;
}

function cloneBoard(b: Board): Board {
  return JSON.parse(JSON.stringify(b)) as Board;
}

// --- EditorFlow spread 의미 미러 ---
// updateAnchor(:235): caption을 spread한 뒤 anchor set/delete — 기존 caption의
// 키를 그대로 이어받는다(깨끗한 caption엔 추가 키를 만들지 않으나 과거 caption의
// 추가 키는 유지). updateCaptionText(:251): caption spread + text 덮기.
// rev4 정적 source pin(QA 리드 kola 판정 #57830): 두 함수는 컴포넌트 내부
// 클로저(setDraft 종속)라 tsx import 실행이 불가 — 아래 EMIT-mirror-pin 행이
// EditorFlow.tsx 실물에서 6종 문구를 indexOf로 단언한다. 화면이 바뀌어 pin이
// 깨지면 미러 PASS라도 소용없다. 화면 수정·helper export·jsdom·new Function 금지.
function anchorSpread(caption: Cut, anchor: { x: number; y: number } | null): Cut {
  const next = { ...caption };
  if (anchor) next.anchor = anchor;
  else delete next.anchor;
  return next;
}

function captionTextSpread(caption: Cut, text: string): Cut {
  return { ...caption, text };
}

// --- 프리셋 fixture ---
function makePreset(): Board {
  return {
    preset_version: "1.1",
    project_name: "온보딩 프로젝트",
    assets: { character_sheet: "asset://sheet", style_refs: [], reference_asset_ids: [] },
    style: {
      keywords: ["포근한"],
      line_weight: "medium",
      palette: ["#FFFFFF"],
      saturation: "pastel",
      character_ratio: "2head",
      background_density: "low",
      bubble_style: "rounded",
    },
    rules: { forbidden: ["어두운"], cta_format: "consult_request", cta_strength: "clear" },
    context: {
      industry: ["교육"],
      interests: ["info_education"],
      age_band: ["20s"],
      life_stage: ["student"],
      main_subjects: ["주인공"],
    },
  };
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
  projects: FakeRow[] = [];
  presets: FakeRow[] = [];
  nextId = 1;
  // 저장 호출 로그(POST 저장 0·PATCH rename 1회·update 0회 확인용)
  projectInserts = 0;
  presetInserts = 0;
  presetUpdates = 0;
  renames = 0;

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  table(table: string): FakeRow[] {
    if (table === "sessions") return this.sessions;
    if (table === "session_versions") return this.sessionVersions;
    if (table === "projects") return this.projects;
    if (table === "presets") return this.presets;
    throw new Error(`unknown table ${table}`);
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

  seedProject(id: string, name: string): void {
    this.projects.push({ id, name, created_at: "2026-10-01T00:00:00Z" });
  }

  seedPreset(id: string, projectId: string, name: string, preset: Board): void {
    this.presets.push({
      id,
      project_id: projectId,
      version: "1.1",
      data: preset,
      projects: { name },
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
  private deleteFlag = false;

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

  delete(): this {
    this.deleteFlag = true;
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
    return this.rowsFrom(this.db.table(this.table));
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
    const all = this.db.table(this.table);
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
      if (this.table === "sessions") {
        const made = this.insertRows.map((r) => ({
          ...r,
          id: `mock-session-${this.db.nextId++}`,
          created_at: "2026-10-06T00:00:00Z",
        }));
        this.db.sessions.push(...made);
        return { data: made, error: null };
      }
      if (this.table === "projects") {
        this.db.projectInserts += this.insertRows.length;
        const made = this.insertRows.map((r) => ({
          ...r,
          id: `mock-project-${this.db.nextId++}`,
          created_at: "2026-10-06T00:00:00Z",
        }));
        this.db.projects.push(...made);
        return { data: made, error: null };
      }
      if (this.table === "presets") {
        this.db.presetInserts += this.insertRows.length;
        const made = this.insertRows.map((r) => ({
          ...r,
          id: `mock-preset-${this.db.nextId++}`,
          created_at: "2026-10-06T00:00:00Z",
        }));
        this.db.presets.push(...made);
        return { data: made, error: null };
      }
      return { data: null, error: { message: `unknown insert table ${this.table}` } };
    }
    if (this.updateVals !== null) {
      if (this.table === "presets") this.db.presetUpdates++;
      if (this.table === "projects") this.db.renames++;
      const matched = this.rows();
      for (const r of matched) Object.assign(r, this.updateVals);
      return { data: matched, error: null };
    }
    if (this.deleteFlag) {
      const matched = this.rows();
      for (const r of matched) {
        const at = all.indexOf(r);
        if (at >= 0) all.splice(at, 1);
      }
      return { data: matched, error: null };
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
      console.log(`ok ${name}`);
    } else {
      bad++;
      console.error(
        `FAIL ${name}${detail === undefined ? "" : " — " + JSON.stringify(detail).slice(0, 400)}`
      );
    }
  };

  let fetchCalls = 0;
  const fetchUrls: string[] = [];
  (globalThis as Record<string, unknown>).fetch = (url: unknown) => {
    fetchCalls++;
    fetchUrls.push(String(url));
    throw new Error("network blocked in verify");
  };

  const { setTestDbClient } = await import("./client");
  const { storyboardContractProblems } = await import("../llm/storyboard-guard");
  const { assertNoPresetExtraKeys } = await import("../llm/preset-guard");
  const { resolvePresetStyle } = await import("../llm/style-resolve");
  const { assembleStoryboard, setCaptionSpeaker } = await import(
    "../../app/(studio)/session/[id]/storyboard-assembly"
  );
  const { getFlowOptions } = await import("../llm/narrative-flow");
  const { validAnchor } = await import("../render/compose");
  const { buildStoryboardJudge } = await import("../../app/api/session/validate");
  const presetRoute = await import("../../app/api/preset/route");
  const sessionRoute = await import("../../app/api/session/route");
  const versionRoute = await import("../../app/api/session/version/route");
  const revertRoute = await import("../../app/api/session/revert/route");

  const inject = (db: FakeDb): void =>
    setTestDbClient(db as unknown as import("@supabase/supabase-js").SupabaseClient);

  async function callRoute(
    fn: (req: Request) => Promise<Response>,
    url: string,
    body: unknown
  ): Promise<{ status: number; json: unknown }> {
    const res = (await fn(
      new Request(url, { method: "POST", body: JSON.stringify(body) })
    )) as Response;
    return { status: res.status, json: (await res.json()) as unknown };
  }

  const postPreset = (db: FakeDb, body: unknown): Promise<{ status: number; json: unknown }> => {
    inject(db);
    return callRoute(presetRoute.POST, "http://localhost/api/preset", body);
  };

  const patchPreset = (
    db: FakeDb,
    body: unknown
  ): Promise<{ status: number; json: unknown }> => {
    inject(db);
    return callRoute(
      presetRoute.PATCH as (req: Request) => Promise<Response>,
      "http://localhost/api/preset",
      body
    );
  };

  // console.warn 캡처(dedupe 중복 제거 로그 줄 수 확인용)
  async function withWarnCapture<T>(fn: () => Promise<T>): Promise<{ out: T; warns: string[] }> {
    const orig = console.warn;
    const warns: string[] = [];
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((a) => String(a)).join(" "));
    };
    try {
      const out = await fn();
      return { out, warns };
    } finally {
      console.warn = orig;
    }
  }

  const SID = "22222222-2222-2222-2222-222222222222";

  // --- EMIT-18: assembleStoryboard 18조합(흐름 3 × CTA 3 × 조연 2) → 0건 ---
  {
    const flows = getFlowOptions();
    let combos = 0;
    let problems = 0;
    for (const flow of flows) {
      for (const strength of ["none", "soft", "clear"] as const) {
        for (const supporting of [null, "조연"] as const) {
          const cta =
            strength === "none"
              ? { strength }
              : { strength, purpose_id: "consult_request" };
          const board = assembleStoryboard(
            "테스트 소재",
            { protagonist: "주인공", supporting, flow },
            ["#FFFFFF"],
            undefined,
            cta
          );
          combos++;
          problems += storyboardContractProblems(board as unknown).length;
        }
      }
    }
    check("EMIT-18", flows.length === 3 && combos === 18 && problems === 0, {
      flows: flows.length,
      combos,
      problems,
    });
  }

  // --- EMIT-dialogue: 가짜 대사 응답 적용 후 → 0건 ---
  {
    const board = assembleStoryboard(
      "테스트 소재",
      { protagonist: "주인공", supporting: null, flow: getFlowOptions()[0] },
      ["#FFFFFF"],
      undefined,
      { strength: "clear", purpose_id: "consult_request" }
    );
    const lines = ["첫 대사", "둘째 대사", "셋째 대사", "신청해 보세요"];
    const withDialogue = {
      ...board,
      cuts: (board.cuts as unknown as Cut[]).map((cut, i) => ({
        ...cut,
        caption: captionTextSpread(cut.caption as Cut, lines[i]),
      })),
    };
    check(
      "EMIT-dialogue",
      storyboardContractProblems(withDialogue as unknown).length === 0,
      storyboardContractProblems(withDialogue as unknown)
    );
  }

  // --- EMIT-speaker: #295 화자 기록(setCaptionSpeaker 2인 컷) 후 → 0건 ---
  {
    const board = assembleStoryboard(
      "테스트 소재",
      { protagonist: "주인공", supporting: "조연", flow: getFlowOptions()[0] },
      ["#FFFFFF"],
      undefined,
      { strength: "clear", purpose_id: "consult_request" }
    );
    const idx = (board.cuts as unknown as Cut[]).findIndex(
      (c) => ((c.characters_in_frame as Cut[]) ?? []).length === 2
    );
    const twoCut = (board.cuts as unknown as Cut[])[idx] as Cut & {
      characters_in_frame: { character_id: string }[];
    };
    const otherId = twoCut.characters_in_frame[1].character_id;
    const recorded = setCaptionSpeaker(
      twoCut as unknown as Parameters<typeof setCaptionSpeaker>[0],
      otherId
    );
    const next = {
      ...board,
      cuts: (board.cuts as unknown as Cut[]).map((c, i) => (i === idx ? recorded : c)),
    };
    const cap = captionOf(recorded as unknown as Cut);
    check(
      "EMIT-speaker",
      idx >= 0 &&
        cap.speaker_index === 1 &&
        storyboardContractProblems(next as unknown).length === 0,
      { idx, speaker: cap.speaker_index }
    );
  }

  // --- EMIT-onboarding: 실제 resolvePresetStyle 출력 + font 확인 응답 +
  // mascot 확인 결과로 조립한 POST 본문 → 무throw + POST 200 ---
  {
    const userKeywords = ["포근한", "밝은"];
    const forbidden = ["어두운"];
    const resolved = resolvePresetStyle({ extracted: null, userKeywords, forbidden });
    const font = { family: "온본체", url: "https://example.com/f.ttf", kind: "file" };
    const mascot = { label: "마스코트", description: "설명" };
    const body = {
      preset_version: "1.1",
      project_name: "온보딩 프로젝트",
      assets: {
        character_sheet: "asset://sheet",
        style_refs: [],
        reference_asset_ids: [],
        font,
      },
      style: { ...resolved.style, keywords: userKeywords, keyword_hints: resolved.keywordHints },
      rules: {
        forbidden,
        forbidden_hints: resolved.forbiddenHints,
        cta_format: "consult_request",
        cta_strength: "clear",
      },
      context: {
        industry: ["교육"],
        interests: ["info_education"],
        age_band: ["20s"],
        life_stage: ["student"],
        main_subjects: ["주인공"],
      },
      mascot,
    };
    let threw: unknown = null;
    try {
      assertNoPresetExtraKeys(body);
    } catch (e) {
      threw = e;
    }
    const db = new FakeDb();
    const r = await postPreset(db, body);
    check("EMIT-onboarding", threw === null && r.status === 200, { threw: String(threw), r });
  }

  // --- EMIT-mascot-hand: 손으로 만든 HTTP 본문(base 화면에 호출 경로 없음 —
  // 화면 경로 PASS로 표기하지 않음) → PATCH 200 ---
  console.log("note EMIT-mascot-hand: 아래 행의 PATCH 본문은 손으로 만든 HTTP 본문이다");
  {
    const db = new FakeDb();
    db.seedProject("p1", "프로젝트");
    db.seedPreset("prm1", "p1", "프로젝트", makePreset());
    const r = await patchPreset(db, {
      id: "prm1",
      mascot: { label: "손 마스코트", description: "손 설명" },
    });
    check("EMIT-mascot-hand", r.status === 200, r);
  }

  // --- EMIT-mirror-pin (rev4): EditorFlow.tsx 실물 정적 source pin 6종 ---
  // 미러(anchorSpread·captionTextSpread)와 함께 실행한다. 1개라도 없으면 FAIL.
  {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/(studio)/editor/[id]/EditorFlow.tsx", "utf8");
    const pins = [
      "function updateAnchor(index: number, anchor: Anchor | null) {",
      "const caption = { ...cut.caption };",
      "if (anchor) caption.anchor = anchor;",
      "else delete caption.anchor;",
      "function updateCaptionText(index: number, text: string) {",
      "{ ...cut.caption, text }",
    ];
    const missing = pins.filter((p) => src.indexOf(p) < 0);
    check("EMIT-mirror-pin", missing.length === 0, missing);
  }

  // --- EMIT-session-new-vs-version: 신규 세션 저장과 기존 version 저장 구분 ---
  // 신규: 에디터 updateAnchor·updateCaptionText spread 경유(깨끗한 caption →
  // 추가 키 0건) → 세션 POST 200.
  {
    const db = new FakeDb();
    const base = makeBoard();
    const edited = cloneBoard(base);
    cutsOf(edited)[1].caption = captionTextSpread(captionOf(cutsOf(edited)[1]), "고친 대사");
    cutsOf(edited)[0].caption = anchorSpread(captionOf(cutsOf(edited)[0]), { x: 0.5, y: 0.5 });
    inject(db);
    const res = (await sessionRoute.POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        body: JSON.stringify({ projectId: "p1", presetId: "pr1", storyboard: edited }),
      })
    )) as Response;
    const j = (await res.json()) as unknown;
    check("EMIT-session-new", res.status === 200, { status: res.status, j });
  }
  // 기존 version: 과거 caption 추가 키는 baseline 보호로 통과(대사 편집 +
  // anchor 삭제 spread 경유) → version POST 200.
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const v1 = makeBoard();
    (captionOf(cutsOf(v1)[0]) as Cut).zzz = 1;
    db.seedVersion(SID, 1, v1);
    const v2 = cloneBoard(v1);
    cutsOf(v2)[1].caption = captionTextSpread(captionOf(cutsOf(v2)[1]), "고친 대사");
    cutsOf(v2)[0].caption = anchorSpread(captionOf(cutsOf(v2)[0]), null);
    const r = await callRoute(
      versionRoute.POST,
      "http://localhost/api/session/version",
      { sessionId: SID, storyboard: v2 }
    );
    check("EMIT-session-version", r.status === 200, r);
  }

  // --- EMIT-anchor-limit: updateAnchor spread 형태 caption의 anchor →
  // ANC 1건·XK 0건 + Export validAnchor 통과 ---
  {
    const board = makeBoard();
    cutsOf(board)[0].caption = anchorSpread(captionOf(cutsOf(board)[0]), { x: 0.5, y: 0.5 });
    (captionOf(cutsOf(board)[0]) as Cut).anchor = { x: 0.5, y: 0.5, zzz: 1 };
    const ps = storyboardContractProblems(board as unknown);
    const anc = ps.filter((p) => p.rule === "ANC");
    const xk = ps.filter((p) => p.rule === "XK");
    const good = validAnchor({ x: 0.5, y: 0.5 });
    const badRange = validAnchor({ x: 2, y: 0 });
    const badType = validAnchor("s");
    check(
      "EMIT-anchor-limit",
      anc.length === 1 && xk.length === 0 && good !== null && badRange === null && badType === null,
      { anc: anc.length, xk: xk.length, good, badRange, badType }
    );
  }

  // --- XKPOST 4곳: 각 추가 키 1개 → 400 + 저장 0 + `<obj>에 허용되지 않은 필드: <키>` ---
  for (const obj of ["assets", "style", "rules", "context"]) {
    const db = new FakeDb();
    const body = makePreset();
    ((body as Board)[obj] as Cut).zzz = 1;
    const { out: r, warns } = await withWarnCapture(() => postPreset(db, body));
    const j = r.json as { error?: string };
    check(`XKPOST-${obj}`, r.status === 400 && db.presetInserts === 0, { r, warns });
    check(`XKPOST-${obj}-msg`, typeof j.error === "string" && j.error.includes(`${obj}에 허용되지 않은 필드: zzz`), j);
    void warns;
  }

  // --- XKPOST-allow: 허용 키만 → 200 + 저장 1회 ---
  {
    const db = new FakeDb();
    const r = await postPreset(db, makePreset());
    check("XKPOST-allow", r.status === 200 && db.presetInserts === 1, r);
  }

  // --- XKPOST-prio-invalid-first: 필수 필드 오류 + 추가 키 → 기존 오류 400 ---
  {
    const db = new FakeDb();
    const body = makePreset();
    body.project_name = "";
    ((body as Board).style as Cut).extra = 1;
    const r = await postPreset(db, body);
    const j = r.json as { error?: string };
    check(
      "XKPOST-prio-invalid-first",
      r.status === 400 &&
        db.presetInserts === 0 &&
        typeof j.error === "string" &&
        !j.error.includes("허용되지 않은 필드"),
      j
    );
  }

  // --- XKPOST-prio-extra-over-dupe: 추가 키 + 중복 → 400 + 중복 제거 로그 0줄 + 저장 0 ---
  {
    const db = new FakeDb();
    const body = makePreset();
    ((body as Board).style as Cut).extra = 1;
    (((body as Board).assets as Cut).style_refs as unknown[])!.push("asset://a", "asset://a");
    const { out: r, warns } = await withWarnCapture(() => postPreset(db, body));
    check(
      "XKPOST-prio-extra-over-dupe",
      r.status === 400 && warns.length === 0 && db.presetInserts === 0,
      { r, warns }
    );
  }

  // --- XKPOST-prio-dupe-only: 중복만 → 200·첫 등장만 저장 ---
  {
    const db = new FakeDb();
    const body = makePreset();
    (((body as Board).assets as Cut).style_refs as unknown[])!.push("asset://a", "asset://a", "asset://b");
    const r = await postPreset(db, body);
    const saved = db.presets[db.presets.length - 1]?.data as Board | undefined;
    const refs = ((saved?.assets as Cut | undefined)?.style_refs as unknown[]) ?? [];
    check(
      "XKPOST-prio-dupe-only",
      r.status === 200 && JSON.stringify(refs) === JSON.stringify(["asset://a", "asset://b"]),
      { r, refs }
    );
  }

  // --- XKPOST-prio-extra-only: 추가 키만 → 400·저장 0 ---
  {
    const db = new FakeDb();
    const body = makePreset();
    ((body as Board).rules as Cut).extra = 1;
    const r = await postPreset(db, body);
    check("XKPOST-prio-extra-only", r.status === 400 && db.presetInserts === 0, r);
  }

  // --- XKPOST-patch-extra-200: 4곳 추가 키 있는 저장본 + mascot 변경 → 현행 200 ---
  {
    const db = new FakeDb();
    db.seedProject("p1", "프로젝트");
    const stored = makePreset();
    ((stored as Board).assets as Cut).legacy_ref = "옛값";
    ((stored as Board).style as Cut).legacy_hint = "옛값";
    ((stored as Board).rules as Cut).legacy_rule = "옛값";
    ((stored as Board).context as Cut).legacy_ctx = "옛값";
    db.seedPreset("pr1", "p1", "프로젝트", stored);
    const r = await patchPreset(db, { id: "pr1", mascot: { label: "M", description: "D" } });
    check("XKPOST-patch-extra-200", r.status === 200, r);
  }

  const judge = buildStoryboardJudge();

  // --- XKPATH-keep: baseline 추가 키 유지 + 대사 편집 → 새 위반 0 ---
  {
    const base = makeBoard();
    (captionOf(cutsOf(base)[0]) as Cut).zzz = 1;
    const next = cloneBoard(base);
    cutsOf(next)[1].caption = captionTextSpread(captionOf(cutsOf(next)[1]), "고친 대사");
    check("XKPATH-keep", judge(next as never, base as never).length === 0);
  }

  // --- XKPATH-partial-del: [a,b] → [b] → 0(키별 payoff) ---
  {
    const base = makeBoard();
    Object.assign(captionOf(cutsOf(base)[0]), { a: 1, b: 2 });
    const next = cloneBoard(base);
    delete (captionOf(cutsOf(next)[0]) as Cut).a;
    check("XKPATH-partial-del", judge(next as never, base as never).length === 0);
  }

  // --- XKPATH-new-key: [a,b] → [a,b,c] → c 1건만(version route 400) ---
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const v1 = makeBoard();
    Object.assign(captionOf(cutsOf(v1)[0]), { a: 1, b: 2 });
    db.seedVersion(SID, 1, v1);
    const v2 = cloneBoard(v1);
    Object.assign(captionOf(cutsOf(v2)[0]), { c: 3 });
    const r = await callRoute(
      versionRoute.POST,
      "http://localhost/api/session/version",
      { sessionId: SID, storyboard: v2 }
    );
    const j = r.json as { problems?: { rule: string; cause: unknown }[] };
    const xk = (j.problems ?? []).filter((p) => p.rule === "XK");
    check(
      "XKPATH-new-key",
      r.status === 400 && xk.length === 1 && xk[0].cause === "c",
      { status: r.status, xk }
    );
  }

  // --- XKPATH-moved: 추가 키를 다른 원소로 이동(cut·cast·frame·subject_tags 각) → 새 위반 ---
  {
    const b1 = makeBoard();
    (cutsOf(b1)[0] as Cut).zzz = 1;
    const n1 = cloneBoard(b1);
    delete (cutsOf(n1)[0] as Cut).zzz;
    (cutsOf(n1)[1] as Cut).zzz = 1;
    check(
      "XKPATH-moved-cut",
      judge(n1 as never, b1 as never).some((p) => p.rule === "XK")
    );
  }
  {
    const b1 = makeBoard();
    ((b1.cast as Cut[])[0] as Cut).zzz = 1;
    const n1 = cloneBoard(b1);
    delete ((n1.cast as Cut[])[0] as Cut).zzz;
    (n1.cast as Cut[]).push({ character_id: "b", role: "supporting", description: "조연", zzz: 1 });
    check(
      "XKPATH-moved-cast",
      judge(n1 as never, b1 as never).some((p) => p.rule === "XK")
    );
  }
  {
    const b1 = makeBoard();
    (((cutsOf(b1)[0].characters_in_frame as Cut[])[0]) as Cut).zzz = 1;
    const n1 = cloneBoard(b1);
    delete ((cutsOf(n1)[0].characters_in_frame as Cut[])[0] as Cut).zzz;
    (((cutsOf(n1)[1].characters_in_frame as Cut[])[0]) as Cut).zzz = 1;
    check(
      "XKPATH-moved-frame",
      judge(n1 as never, b1 as never).some((p) => p.rule === "XK")
    );
  }
  {
    const b1 = makeBoard();
    b1.subject_tags = [
      { raw: "a", category: "b", zzz: 1 },
      { raw: "c", category: "d" },
    ];
    const n1 = cloneBoard(b1);
    delete ((n1.subject_tags as Cut[])[0] as Cut).zzz;
    ((n1.subject_tags as Cut[])[1] as Cut).zzz = 1;
    check(
      "XKPATH-moved-subjtag",
      judge(n1 as never, b1 as never).some((p) => p.rule === "XK")
    );
  }

  // --- XKPATH-unstable: `!` 컷에서 이동 시험 → 새 위반 ---
  {
    const b1 = makeBoard();
    cutsOf(b1)[1].cut_index = 1;
    (captionOf(cutsOf(b1)[0]) as Cut).zzz = 1;
    const n1 = cloneBoard(b1);
    delete (captionOf(cutsOf(n1)[0]) as Cut).zzz;
    (captionOf(cutsOf(n1)[1]) as Cut).zzz = 1;
    check(
      "XKPATH-unstable",
      judge(n1 as never, b1 as never).some((p) => p.rule === "XK")
    );
  }

  // --- XKPATH-subjtag-shift: 앞 원소 삭제 → 새 위반(알려진 엄격 동작) ---
  {
    const b1 = makeBoard();
    b1.subject_tags = [{ raw: "a", category: "b" }, { raw: "c", category: "d", zzz: 1 }];
    const n1 = cloneBoard(b1);
    (n1.subject_tags as Cut[]).shift();
    check(
      "XKPATH-subjtag-shift",
      judge(n1 as never, b1 as never).some((p) => p.rule === "XK")
    );
  }

  // --- XKPATH-revert-409: revert 대상에 새 추가 키 → 409 ---
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    const v1 = makeBoard();
    (captionOf(cutsOf(v1)[0]) as Cut).zzz = 1;
    db.seedVersion(SID, 1, v1);
    db.seedVersion(SID, 2, makeBoard());
    const r = await callRoute(revertRoute.POST, "http://localhost/api/session/revert", {
      sessionId: SID,
    });
    check("XKPATH-revert-409", r.status === 409, r);
  }

  // --- XKPATH-version-400|200: version 새 키 → 400 / 동일 → 200 ---
  {
    const db = new FakeDb();
    inject(db);
    db.seedSession(SID);
    db.seedVersion(SID, 1, makeBoard());
    const bad = makeBoard();
    (cutsOf(bad)[2] as Cut).zzz = 1;
    const r400 = await callRoute(
      versionRoute.POST,
      "http://localhost/api/session/version",
      { sessionId: SID, storyboard: bad }
    );
    const r200 = await callRoute(
      versionRoute.POST,
      "http://localhost/api/session/version",
      { sessionId: SID, storyboard: makeBoard() }
    );
    check(
      "XKPATH-version-400",
      r400.status === 400,
      { status: r400.status, json: r400.json }
    );
    check(
      "XKPATH-version-200",
      r200.status === 200,
      { status: r200.status, json: r200.json }
    );
  }

  // --- XKPATCH-compound: 복합 + mascot 검증 실패 → rename 1회·updatePresetData 0회·400 ---
  {
    const db = new FakeDb();
    db.seedProject("pc1", "옛 이름");
    db.seedPreset("prc1", "pc1", "옛 이름", makePreset());
    const r = await patchPreset(db, {
      projectId: "pc1",
      name: "새 이름",
      id: "prc1",
      mascot: { label: "", description: "D" },
    });
    check(
      "XKPATCH-compound",
      r.status === 400 && db.renames === 1 && db.presetUpdates === 0,
      { r, renames: db.renames, updates: db.presetUpdates }
    );
  }

  check("no-real-network", fetchCalls === 0, fetchUrls);
  setTestDbClient(null);

  if (bad > 0) {
    console.error(`263R1B-EMIT ${bad}건 실패`);
    process.exit(1);
  }
  console.log("OK 263R1B-EMIT");
}

main().catch((e) => {
  console.error(`FAIL driver — ${String(e).slice(0, 300)}`);
  process.exit(1);
});

// 모듈 스코프 선언 — 같은 디렉토리의 다른 *.verify.ts와 전역 타입 충돌 방지.
// 런타임 영향 없음.
export {};
