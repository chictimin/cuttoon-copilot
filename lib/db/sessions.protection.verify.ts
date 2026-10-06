// spec-263 P1-b 모의 검증(verify-commands-263 #4).
// 실행: npx tsx lib/db/sessions.protection.verify.ts
//
// 모의 DB repository로 보호·경합·revert를 검증한다(무료). 실DB·외부 fetch 금지.
// 순수 판정(findNewViolations·buildStoryboardJudge·subjectTagsProblem)은 실제
// 코드를 import해 쓰고, DB 왕복·unique 충돌·쓰기 카운터만 모의로 둔다.
// sessions.ts·route.ts 본체는 server-only 체라 tsx 기본 조건에서 import하지
// 않고, 배선 존재는 소스 정적 확인으로 보증한다.

import { readFileSync } from "node:fs";

import {
  buildStoryboardJudge,
  findNewViolations,
} from "../../app/api/session/validate";
import { subjectTagsProblem } from "../llm/subject-tags";

type Board = Record<string, unknown>;
type Cut = Record<string, unknown>;

// --- 모의 에러(실코드 sessions.ts의 동명 클래스와 같은 자리) ---
class MockProtectionError extends Error {
  problems: unknown[];
  constructor(problems: unknown[]) {
    super(`스토리보드 계약 위반 ${problems.length}건`);
    this.problems = problems;
  }
}
class MockVersionConflictError extends Error {}

type Judge = (nb: unknown, baseline: Board | null) => { rule: string }[];

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

// --- 모의 repository(sessions.ts saveSessionVersion·revertSession과 같은 순서) ---
class MockRepo {
  versions: { version: number; storyboard: Board }[] = [];
  subject = "소재";
  inserts = 0;
  subjectWrites = 0;
  judgedInserts = 0;

  constructor(initial: Board[]) {
    this.versions = initial.map((sb, i) => ({ version: i + 1, storyboard: sb }));
  }

  latest(): { version: number; storyboard: Board } {
    return this.versions[this.versions.length - 1];
  }

  // 같은 조회 결과로 판정 → insert. unique 충돌은 재시도·재판정 없이 409.
  save(newSb: Board, judge: Judge, baselineVersion?: number): number {
    const latest =
      baselineVersion === undefined
        ? this.latest()
        : (this.versions.find((v) => v.version === baselineVersion) as {
            version: number;
            storyboard: Board;
          });
    const problems = judge(newSb, latest.storyboard);
    if (problems.length > 0) throw new MockProtectionError(problems);
    const next = latest.version + 1;
    if (this.versions.some((v) => v.version === next)) {
      throw new MockVersionConflictError(`version_conflict v${next}`);
    }
    this.versions.push({ version: next, storyboard: newSb });
    this.inserts++;
    this.judgedInserts++;
    this.subjectWrites++;
    return next;
  }

  revert(judge: Judge): { ok: true; version: number } | { ok: false; reason: string } {
    if (this.versions.length < 2) return { ok: false, reason: "no_previous_version" };
    const current = this.versions[this.versions.length - 1];
    const previous = this.versions[this.versions.length - 2];
    const tags = (previous.storyboard as Board).subject_tags;
    if (tags !== undefined && subjectTagsProblem(tags) !== null) {
      return { ok: false, reason: "invalid_subject_tags" };
    }
    const problems = judge(previous.storyboard, current.storyboard);
    if (problems.length > 0) return { ok: false, reason: "invalid_storyboard" };
    const next = current.version + 1;
    this.versions.push({ version: next, storyboard: previous.storyboard });
    this.inserts++;
    this.subjectWrites++;
    return { ok: true, version: next };
  }
}

// --- 검사 ---
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

const judge = buildStoryboardJudge() as unknown as Judge;

// 보호 통과 2종
{
  const baseline = validBoard();
  (cutsOf(baseline)[0] as Cut).narrative_beat = "problm";
  const edited = clone(baseline);
  ((cutsOf(edited)[1].caption as Cut) as Cut).text = "고친 대사";
  check("보호통과 기존위반+정상편집", findNewViolations(edited, baseline).length === 0);
}
{
  const baseline = validBoard();
  cutsOf(baseline)[1].cut_index = 1; // 깨진 cut_index(불안정 locator)
  const edited = clone(baseline);
  ((cutsOf(edited)[2].caption as Cut) as Cut).position = "center";
  ((cutsOf(edited)[2].caption as Cut) as Cut).text = "고친 대사";
  check("보호통과 불안정locator caption편집", findNewViolations(edited, baseline).length === 0);
}

// 보호 거부 5종
{
  const baseline = validBoard();
  (cutsOf(baseline)[0] as Cut).generated_image = "stub-x";
  const worsened = clone(baseline);
  (cutsOf(worsened)[0] as Cut).generated_image = "https://evil.example/x.png";
  const nv = findNewViolations(worsened, baseline);
  check("보호거부 값악화", nv.some((p) => p.rule === "A1"), nv);
}
{
  const baseline = validBoard();
  baseline.cuts = cutsOf(baseline).slice(0, 3);
  const worsened = validBoard();
  worsened.cuts = cutsOf(worsened).slice(0, 1);
  check("보호거부 개수악화", findNewViolations(worsened, baseline).length > 0);
}
{
  const baseline = validBoard();
  (cutsOf(baseline)[0] as Cut).narrative_beat = "problm";
  const swapped = clone(baseline);
  (cutsOf(swapped)[0] as Cut).narrative_beat = "probelm";
  const nv = findNewViolations(swapped, baseline);
  check("보호거부 다른오타교체", nv.some((p) => p.rule === "A6"), nv);
}
{
  // 불안정 locator 세션에서 인덱스 교환으로 예외를 다른 개체에 물려주기
  const baseline = validBoard();
  cutsOf(baseline)[0].cut_index = 1;
  cutsOf(baseline)[1].cut_index = 1;
  (cutsOf(baseline)[0] as Cut).narrative_beat = "problm";
  const moved = clone(baseline);
  const c = cutsOf(moved);
  const tmp = c[0];
  c[0] = c[1];
  c[1] = tmp;
  check("보호거부 위치교환", findNewViolations(moved, baseline).length > 0);
}
{
  const baseline = validBoard();
  (cutsOf(baseline)[0] as Cut).narrative_beat = "problm";
  const fixed = clone(baseline);
  (cutsOf(fixed)[0] as Cut).narrative_beat = "problem";
  (cutsOf(fixed)[1] as Cut).shot_type = "초접사";
  check("보호거부 고친뒤재유입", findNewViolations(fixed, baseline).length > 0);
}

// frame 인물 이동 보호 회귀(spec-263 rev5 3-1 "frame" 줄)
// (a) frame id만 a→b 변경(위반 유지) → 새 위반
{
  const baseline = validBoard();
  baseline.cast = [
    { character_id: "a", role: "protagonist", description: "주인공" },
    { character_id: "b", role: "supporting", description: "조연" },
  ];
  (((cutsOf(baseline)[0] as Cut).characters_in_frame as Cut[])[0] as Cut).expression = "smil";
  const moved = clone(baseline);
  (((cutsOf(moved)[0] as Cut).characters_in_frame as Cut[])[0] as Cut).character_id = "b";
  const nv = findNewViolations(moved, baseline);
  check("보호거부 frame인물이동", nv.length > 0, nv);
}
// (b) 두 인물 frame 교환(위반이 다른 인물로) → 새 위반
{
  const baseline = validBoard();
  baseline.cast = [
    { character_id: "a", role: "protagonist", description: "주인공" },
    { character_id: "b", role: "supporting", description: "조연" },
  ];
  (cutsOf(baseline)[0] as Cut).characters_in_frame = [
    { character_id: "a", expression: "smil", pose: "stand" },
    { character_id: "b", expression: "smile", pose: "stand" },
  ];
  const moved = clone(baseline);
  (cutsOf(moved)[0] as Cut).characters_in_frame = [
    { character_id: "b", expression: "smil", pose: "stand" },
    { character_id: "a", expression: "smile", pose: "stand" },
  ];
  const nv = findNewViolations(moved, baseline);
  check("보호거부 frame교환", nv.length > 0, nv);
}
// (c) id 그대로 caption.text·position 편집 → 통과
{
  const baseline = validBoard();
  (((cutsOf(baseline)[0] as Cut).characters_in_frame as Cut[])[0] as Cut).expression = "smil";
  const edited = clone(baseline);
  ((cutsOf(edited)[0].caption as Cut) as Cut).text = "고친 대사";
  ((cutsOf(edited)[0].caption as Cut) as Cut).position = "center";
  check("보호통과 frame유지 caption편집", findNewViolations(edited, baseline).length === 0);
}

// 경합: 같은 baseline에서 두 저장 동시 → 하나 200, 하나 409
{
  const repo = new MockRepo([validBoard()]);
  const v1 = repo.latest().version;
  const vA = repo.save(validBoard(), judge);
  let conflict: unknown = null;
  try {
    repo.save(validBoard(), judge, v1);
  } catch (e) {
    conflict = e;
  }
  check(
    "경합 200+409+판정안된버전0",
    vA === 2 &&
      conflict instanceof MockVersionConflictError &&
      repo.versions.length === 2 &&
      repo.judgedInserts === repo.versions.length - 1
  );
}

// revert: 최신에 없는 위반 이력 → invalid_storyboard + 쓰기 0
{
  const current = validBoard();
  const previous = validBoard();
  (cutsOf(previous)[0] as Cut).generated_image = "stub-x";
  const repo = new MockRepo([previous, current]);
  const before = { inserts: repo.inserts, writes: repo.subjectWrites, n: repo.versions.length };
  const r = repo.revert(judge);
  check(
    "revert 위반이력 쓰기0",
    !r.ok &&
      (r as { reason: string }).reason === "invalid_storyboard" &&
      repo.inserts === before.inserts &&
      repo.subjectWrites === before.writes &&
      repo.versions.length === before.n
  );
}
{
  const current = validBoard();
  const previous = validBoard();
  (cutsOf(previous)[0] as Cut).generated_image = "stub-x";
  previous.subject_tags = [{ raw: "태그" }];
  const repo = new MockRepo([previous, current]);
  const r = repo.revert(judge);
  check(
    "revert subject_tags 우선",
    !r.ok && (r as { reason: string }).reason === "invalid_subject_tags"
  );
}
{
  const v2 = validBoard();
  const v1 = validBoard();
  const repo = new MockRepo([v1, v2]);
  const r = repo.revert(judge);
  check("revert 정상통과", r.ok === true && repo.versions.length === 3);
}

// POST 상당: 새 세션(baseline 없음)은 위반 각 → 거부
{
  const cases: Array<[string, (b: Board) => void, string]> = [
    ["POST상당 A1", (b) => ((cutsOf(b)[0] as Cut).generated_image = "stub-x"), "A1"],
    ["POST상당 A4", (b) => (b.cuts = cutsOf(b).slice(0, 3)), "A4"],
    [
      "POST상당 A3",
      (b) =>
        (b.cast = [
          { character_id: "a", role: "protagonist", description: "d" },
          { character_id: "b", role: "protagonist", description: "e" },
        ]),
      "A3",
    ],
    ["POST상당 CTA", (b) => ((cutsOf(b)[0] as Cut).narrative_beat = "cta"), "CTA"],
  ];
  for (const [name, mutate, rule] of cases) {
    const b = validBoard();
    mutate(b);
    const nv = findNewViolations(b, null);
    check(name, nv.some((p) => p.rule === rule), nv);
  }
}

// asset:// 표지 선택 기록 회귀 — A1 없음
{
  const b = validBoard();
  for (const c of cutsOf(b)) c.generated_image = "asset://cover-1.png";
  check(
    "asset 회귀",
    findNewViolations(b, null).filter((p) => p.rule === "A1").length === 0
  );
}

// GET·Export 동일 — 읽기 경로에 보호 배선 없음(정적 확인)
{
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
    "Export 무변경",
    markers.every((m) => !exportSrc.includes(m)) && getSrc.length > 0
  );
  check("GET 무변경", markers.every((m) => !getSrc.includes(m)));
}

// 저장 배선 존재 — 실코드 소스 정적 확인
{
  const sessionsSrc = readFileSync("lib/db/sessions.ts", "utf8");
  const versionSrc = readFileSync("app/api/session/version/route.ts", "utf8");
  const revertSrc = readFileSync("app/api/session/revert/route.ts", "utf8");
  const validateSrc = readFileSync("app/api/session/validate.ts", "utf8");
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
}

if (bad > 0) {
  console.error(`263-F2 ${bad}건 실패`);
  process.exit(1);
}
console.log("OK 263-F2");
