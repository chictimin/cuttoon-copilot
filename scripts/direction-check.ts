/**
 * #325 연출 반영 POC 확인 스크립트 + #326 컷 참조 방식 비교 실험. 유료 실행은 사람이 한다.
 *
 * 기존 세션 하나의 스토리보드·preset·시트를 읽어, 컷 2~4에 서로 다른 연출을
 * 지정하고(기본 2 full·eye / 3 closeup·high / 4 wide·low, --cut1 로 컷 1도 지정 가능),
 * --mode 에 따라 표지(또는 레퍼런스)와 컷 이미지를 만든다. "구도·앵글·연출 메모가 그림에
 * 먹히는가", "컷 사이 인물(얼굴·피부색·옷·머리색)이 유지되는가" 를 사람이 본다.
 *
 * - DB·Storage 쓰기 0. 세션·preset 은 getSession·getPreset, 시트는 readAsset 으로 읽기만 한다.
 * - generate.ts 의 생성 함수들은 결과를 uploadAsset(Storage 쓰기)하고, 그 앞 단계
 *   (callImageGeneration)는 export 돼 있지 않다. 제품 코드를 고치지 않으려고 같은 요청을
 *   여기서 재현한다 — 모델(gpt-5 + image_generation)·크기(OUTPUT_SIZE)·quality(imageQuality)·
 *   첨부(모드별 generateCut 참조 고르기와 같게)·프롬프트(buildCutPrompt·buildReferencePrompt
 *   출력 그대로, 표지 구도는 coverDirectionsForMode 그대로)·이어받기(previous_response_id).
 * - **기본은 --dry-run**: 이미지 호출 0, 프롬프트와 요청별 첨부·이어받기만 출력·저장한다.
 *   유료 생성은 --run 을 명시했을 때만 나간다. 1회 실행 최대 이미지 8장(MAX_IMAGES).
 *   --run의 OpenAI 클라이언트는 maxRetries 0이라 SDK 자동 재시도가 없어 실제 HTTP 생성
 *   시도는 모드별 장수(아래)로 고정된다.
 * - --dry-run에 실제 세션 id를 주면 DB 읽기(getSession·getPreset·시트 readAsset)는 실제로
 *   한다. 쓰기(uploadAsset·이미지 호출)는 dry-run 경로에 없어 0이 보장된다.
 *   세션을 생략하면 내장 fake로 돌며 그때만 외부 요청을 전부 가로챈다(.env·네트워크 없음).
 *
 * 실행(유료, 원본 폴더에서):
 *   npx tsx --env-file=.env --conditions=react-server scripts/direction-check.ts --session <세션 id> --mode <모드> --run
 * 실제 세션 프롬프트만(유료 0, DB 읽기만):
 *   npx tsx --env-file=.env --conditions=react-server scripts/direction-check.ts --session <세션 id> --mode <모드> --dry-run
 * 프롬프트만(유료 0, .env·네트워크 없음):
 *   npx tsx --conditions=react-server scripts/direction-check.ts --mode <모드> --dry-run
 *
 * 옵션: --session <id>(--run 필수, --dry-run은 생략 시 fake) · --cut1/--cut2/--cut3/--cut4 <shot,angle>
 *   (--cut1 생략 시 세션 값) · --note "<문장>" · --note-cut <2|3|4, 기본 3> · --out <폴더>(기본
 *   tmp/direction-check, 아래 시각 하위폴더) · --dry-run(기본) · --run ·
 *   --mode <아래, 기본 chain> · --cover-pick <1|2|3, 기본 1 — 표지 3안이 있는 모드에서 컷 1로 고를 안> ·
 *   --ref-style <on|off, 기본 on — 레퍼런스(C·C´)에 참고 그림을 붙일지. 제품은 NEXT_PUBLIC_REFERENCE_STYLE_REFS>
 *
 * --mode(lib/cut-reference-mode.ts 와 같은 값, 제품은 NEXT_PUBLIC_CUT_REFERENCE_MODE):
 * - chain(A): 표지 3안(S5 배정) → 고른 표지가 컷 1, 컷 2~4 이어받기, 첨부 [시트, ...style_refs]. 6장.
 * - chain-nostyle(A´): A와 같되 컷 2~4 첨부는 시트만. 6장.
 * - cover-ref(C): 레퍼런스 1장(bust·eye + 배경) → 컷 1~4를 [시트, 레퍼런스]로 이어받기 없이 동시. 5장.
 * - cover-ref-chain(C´): C와 같되 레퍼런스 응답에서 시작해 컷 1→4 이어받기(화면 13986bc 흐름과 같다). 5장.
 * - cover-fixed(D): 표지 3안을 모두 bust·eye로 → 고른 표지가 컷 1, 컷 2~4는 [시트, 고른 표지] +
 *   이어받기. 6장.
 * 어느 모드든 인물 0명 컷은 제품(generateCut)처럼 시트를 첨부에서 뺀다.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { imageQuality, imageSetting } from "../lib/openai/image-setting";
import { normalizeTagText, parseSubjectTags } from "../lib/llm/subject-tags";
// generate.ts 는 불러오는 순간 OpenAI·Supabase 환경변수를 요구한다(모듈 최상위 클라이언트).
// --dry-run 이 가짜 값을 깐 뒤, 실제 실행은 --run 확인 뒤에 동적으로 불러온다.

const MAX_IMAGES = 8; // 1회 실행 상한. 모드별 최대 6장이라 기본 구성은 항상 안쪽이다.
const RESPONSES_MODEL = "gpt-5"; // generate.ts RESPONSES_MODEL 과 같은 값
// generate.ts OUTPUT_SIZE(1024×1024)와 같은 값. 불러온 뒤 같은지 다시 확인한다.
const IMAGE_SIZE = "1024x1024";
// --dry-run + --session 생략(fake) 때 쓰는 기본 연출 메모. 소재 [태그] 원문을 일부러
// 넣어 브랜드 투영(projectForModel)이 메모에도 걸리는지 같이 본다.
const FAKE_NOTE = "손에 [블루핏 앱]을 들고 환하게 웃기";

type Mode = "chain" | "chain-nostyle" | "cover-ref" | "cover-ref-chain" | "cover-fixed";
const MODES: readonly Mode[] = ["chain", "chain-nostyle", "cover-ref", "cover-ref-chain", "cover-fixed"];
type Spec = { shot: string; angle: string };

interface Args {
  session: string;
  cut1: Spec | undefined;
  cutSpecs: Record<2 | 3 | 4, Spec>;
  note: string | undefined;
  noteCut: 2 | 3 | 4;
  outBase: string;
  run: boolean;
  mode: Mode;
  coverPick: 1 | 2 | 3;
  refStyle: boolean;
}

type CastMember = { character_id?: string; role?: string; description?: string };
type FrameMember = { character_id?: string; expression?: string; pose?: string };
type Cut = {
  cut_index?: number;
  shot_type?: string;
  camera_angle?: string;
  direction_note?: string;
  characters_in_frame?: FrameMember[];
  generated_image?: string | null;
  [k: string]: unknown;
};
type Storyboard = { subject?: string; cast?: CastMember[]; cuts?: Cut[]; subject_tags?: unknown; [k: string]: unknown };
type Preset = { assets?: { character_sheet?: string; style_refs?: string[] }; [k: string]: unknown };

interface Loaded {
  storyboard: Storyboard;
  preset: Preset;
  readAsset: (uri: string) => Promise<Buffer | null>;
}

// 요청 하나. attach 는 애셋 URI 또는 앞 요청의 파일 라벨(cover-N·reference), prev 는 이어받을
// 앞 요청의 파일 라벨. --dry-run 은 이 목록을 기록만 하고, --run 은 이 순서대로 보낸다.
interface Req {
  file: string; // 확장자 없는 파일 이름(cover-1·reference·cut-2)
  kind: "cover" | "reference" | "cut";
  cutIndex?: number;
  prompt: string;
  attach: string[];
  prev: string | null;
  note: string;
}

function parseCutSpec(raw: string | undefined, name: string): Spec {
  if (!raw) throw new Error(`${name} 은 <shot,angle> 형태여야 합니다(받음: 없음)`);
  const [shot, angle] = raw.split(",").map((s) => s.trim());
  if (!shot || !angle) throw new Error(`${name} 은 <shot,angle> 형태여야 합니다(받음: ${raw})`);
  return { shot, angle };
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const run = argv.includes("--run");
  if (run && argv.includes("--dry-run")) throw new Error("--run 과 --dry-run 을 같이 주지 마세요");
  const session = get("--session") ?? (run ? undefined : "fake");
  if (!session) throw new Error("--session <세션 id> 가 필요합니다(--run 실행은 fake 불가)");
  const noteCutRaw = get("--note-cut") ?? "3";
  if (noteCutRaw !== "2" && noteCutRaw !== "3" && noteCutRaw !== "4") {
    throw new Error(`--note-cut 은 2|3|4 중 하나여야 합니다(받음: ${noteCutRaw})`);
  }
  const modeRaw = get("--mode") ?? "chain";
  if (!(MODES as readonly string[]).includes(modeRaw)) {
    throw new Error(`--mode 는 ${MODES.join("|")} 중 하나여야 합니다(받음: ${modeRaw})`);
  }
  const pickRaw = get("--cover-pick") ?? "1";
  if (pickRaw !== "1" && pickRaw !== "2" && pickRaw !== "3") {
    throw new Error(`--cover-pick 은 1|2|3 중 하나여야 합니다(받음: ${pickRaw})`);
  }
  const refStyleRaw = get("--ref-style") ?? "on";
  if (refStyleRaw !== "on" && refStyleRaw !== "off") {
    throw new Error(`--ref-style 은 on|off 중 하나여야 합니다(받음: ${refStyleRaw})`);
  }
  const cut1Raw = get("--cut1");
  return {
    mode: modeRaw as Mode,
    coverPick: Number(pickRaw) as 1 | 2 | 3,
    refStyle: refStyleRaw === "on",
    session,
    cut1: cut1Raw !== undefined ? parseCutSpec(cut1Raw, "--cut1") : undefined,
    cutSpecs: {
      2: parseCutSpec(get("--cut2") ?? "full,eye", "--cut2"),
      3: parseCutSpec(get("--cut3") ?? "closeup,high", "--cut3"),
      4: parseCutSpec(get("--cut4") ?? "wide,low", "--cut4"),
    },
    note: get("--note") ?? (session === "fake" ? FAKE_NOTE : undefined),
    noteCut: Number(noteCutRaw) as 2 | 3 | 4,
    outBase: get("--out") ?? "tmp/direction-check",
    run,
  };
}

async function loadReal(sessionId: string): Promise<Loaded> {
  // 동적 import: --dry-run(fake)에서는 DB 모듈을 불러오지 않는다.
  const { getSession } = await import("../lib/db/sessions");
  const { getPreset } = await import("../lib/db/presets");
  const { readAsset } = await import("../lib/asset-store");
  const saved = await getSession(sessionId);
  if (!saved) throw new Error(`세션을 찾지 못했습니다: ${sessionId}`);
  const preset = await getPreset(saved.presetId);
  if (!preset) throw new Error(`세션의 preset 을 찾지 못했습니다: ${saved.presetId}`);
  return { storyboard: saved.storyboard as unknown as Storyboard, preset: preset.preset as unknown as Preset, readAsset };
}

async function loadDry(): Promise<Loaded> {
  const sheet = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const one = (i: number): Cut => ({
    cut_index: i,
    narrative_beat: "problem",
    // #325 배경: closeup 계열을 요청했는데 전신으로 나왔다. 기준(컷 1)도 closeup 계열로 둔다.
    shot_type: "closeup",
    camera_angle: "eye",
    characters_in_frame: [{ character_id: "protagonist", expression: "worried", pose: "stand" }],
    reserved_zone: "top",
    generated_image: null,
  });
  return {
    storyboard: {
      subject: "[블루핏 앱]으로 퇴근 후 무릎 스트레칭",
      subject_tags: [{ raw: "블루핏 앱", category: "운동 앱" }],
      cast: [{ character_id: "protagonist", role: "protagonist", description: "하루 종일 서서 일하는 40대 카페 사장님, 상의 #e8734a" }],
      cuts: [1, 2, 3, 4].map(one),
    },
    // 참고 그림 1장을 둔다 — #326 실험(A/A'/C)은 참고 그림이 있는 조건에서 첨부 차이를 본다.
    preset: {
      style: { line_weight: "medium", saturation: "pastel", character_ratio: "2.5head" },
      assets: { character_sheet: "asset://dry-sheet", style_refs: ["asset://dry-style"] },
    },
    readAsset: async (uri) => (uri === "asset://dry-sheet" || uri === "asset://dry-style" ? sheet : null),
  };
}

function applyDirection(storyboard: Storyboard, args: Args): Storyboard {
  const specs: Partial<Record<number, Spec>> = { ...args.cutSpecs, ...(args.cut1 ? { 1: args.cut1 } : {}) };
  const cuts = storyboard.cuts ?? [];
  for (const index of [1, 2, 3, 4]) {
    if (!cuts.some((c) => c.cut_index === index)) throw new Error(`컷 ${index}를 찾지 못했습니다`);
  }
  return {
    ...storyboard,
    cuts: cuts.map((c) => {
      const spec = c.cut_index !== undefined ? specs[c.cut_index] : undefined;
      return {
        ...c,
        ...(spec ? { shot_type: spec.shot, camera_angle: spec.angle } : {}),
        ...(c.cut_index === args.noteCut && args.note !== undefined ? { direction_note: args.note } : {}),
        generated_image: null,
      };
    }),
  };
}

function framingCamera(prompt: string): string {
  const framing = prompt.match(/Framing: (.+?)\./)?.[1];
  const camera = prompt.match(/Camera: (.+?)\./)?.[1];
  return `${framing ?? "?"} / ${camera ?? "?"}`;
}

const CHAIN = "This panel continues the earlier panels of this conversation.";
const REF_IMAGE = "reference panel of this same comic";
const REF_PANEL = "This is the reference panel for the whole comic";
const ZONE = "A speech bubble is composited there later.";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const setting = imageSetting();
  if (setting === "comfyui") throw new Error("이 확인은 OpenAI 이미지로 한다 — IMAGE_PROVIDER 를 비우거나 openai 로 두세요");
  const quality = imageQuality(setting);
  const refMode = args.mode === "cover-ref" || args.mode === "cover-ref-chain"; // 레퍼런스 1장 구조
  const totalImages = refMode ? 1 + 4 : 3 + 3;
  if (totalImages > MAX_IMAGES) throw new Error(`1회 ${totalImages}장은 상한(${MAX_IMAGES}장)을 넘겨 거부합니다`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(args.outBase, stamp);

  console.log(
    `${args.run ? "[--run, 유료] " : "[--dry-run, 이미지 호출 0] "}모드 ${args.mode} · 이미지 ${totalImages}장 — 모델 ${RESPONSES_MODEL} + image_generation, ` +
      `크기 ${IMAGE_SIZE}, 품질 ${quality ?? "기본(지정 안 함)"} (IMAGE_PROVIDER=${setting}), 결과 ${out}/`
  );
  console.log(
    `연출: 컷 1 ${args.cut1 ? `${args.cut1.shot}·${args.cut1.angle}` : "세션 값"} / ` +
      ([2, 3, 4] as const).map((i) => `컷 ${i} ${args.cutSpecs[i].shot}·${args.cutSpecs[i].angle}`).join(" / ") +
      (args.note !== undefined ? ` / 메모(컷 ${args.noteCut}): ${args.note}` : " / 메모 없음") +
      (refMode ? "" : ` / 컷 1로 고를 표지 ${args.coverPick}안`)
  );

  // fake 세션의 --dry-run만 모든 fetch 를 가로채 외부로 나가지 않게 한다. 실제 세션 id의
  // --dry-run은 DB 읽기(getSession·getPreset·readAsset)를 실제로 하므로 가로채지 않는다.
  // 쓰기는 어느 dry-run에서도 나가지 않는다 — uploadAsset·OpenAI 호출이 dry-run 경로에 없다.
  // OpenAI 클라이언트가 만들어지기 전에 바꾼다.
  const useFake = !args.run && args.session === "fake";
  const requests: string[] = [];
  if (useFake) {
    process.env.SUPABASE_URL = "https://demo.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "demo";
    process.env.OPENAI_API_KEY = "sk-dry-fake";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      requests.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  } else if (!args.run && !process.env.OPENAI_API_KEY) {
    // 실제 세션 읽기 모드: DB(getSession·getPreset·readAsset)는 실제 env로 나가고,
    // generate.ts 동적 import용 키만 없을 때 가짜를 깐다. 이 키로는 호출하지 않는다.
    process.env.OPENAI_API_KEY = "sk-dry-fake";
  }
  // 제품 코드와 같은 스위치 값을 깔아 둔다 — coverDirectionsForMode 가 이 값으로 표지 구도를 정한다.
  process.env.NEXT_PUBLIC_CUT_REFERENCE_MODE = args.mode;
  process.env.NEXT_PUBLIC_REFERENCE_STYLE_REFS = args.refStyle ? "on" : "off";
  const { OUTPUT_SIZE, buildCutPrompt, buildReferencePrompt, coverDirectionsForMode } = await import("../lib/openai/generate");
  if (`${OUTPUT_SIZE.width}x${OUTPUT_SIZE.height}` !== IMAGE_SIZE) throw new Error("OUTPUT_SIZE 가 바뀌었습니다 — 이 스크립트의 IMAGE_SIZE 를 맞추세요");

  const loaded = args.session === "fake" ? await loadDry() : await loadReal(args.session);
  if (args.session === "fake" && args.run) throw new Error("--run 실행은 실제 세션이 필요합니다");
  const storyboard = applyDirection(loaded.storyboard, args);
  const cutOf = (i: number): Cut => (storyboard.cuts ?? []).find((c) => c.cut_index === i) ?? { cut_index: i };

  // ── 요청 목록 (모드별 generateCut·generateReference·generateCoverVariants 재현) ──
  const sheetUri = loaded.preset.assets?.character_sheet;
  const styleUris = (loaded.preset.assets?.style_refs ?? []).filter((u) => u !== sheetUri);
  const firstAttach = [sheetUri, ...styleUris].filter((u): u is string => typeof u === "string");
  const noPeople = (i: number) => (cutOf(i).characters_in_frame ?? []).length === 0;
  const withSheet = (i: number, labels: (string | undefined)[]) =>
    labels.filter((u): u is string => typeof u === "string" && !(noPeople(i) && u === sheetUri));
  const reqs: Req[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = (cut: Cut, opts: Parameters<typeof buildCutPrompt>[3]) => buildCutPrompt(storyboard as any, loaded.preset as any, cut as any, opts);

  if (refMode) {
    // C·C´: 레퍼런스 1장(첨부 [시트, ...style_refs], 이어받기 없음) → 컷 1~4는 [시트, 레퍼런스].
    // 첨부는 [시트, ...style_refs], --ref-style off 면 시트만(generate.ts referenceAttachments 와 같다).
    const refAttach = args.refStyle ? firstAttach : firstAttach.filter((u) => u === sheetUri);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reqs.push({ file: "reference", kind: "reference", prompt: buildReferencePrompt(storyboard as any, loaded.preset as any), attach: refAttach, prev: null, note: `레퍼런스(bust·eye, 참고 그림 ${args.refStyle ? "on" : "off"})` });
    for (const i of [1, 2, 3, 4]) {
      // C´: 화면(13986bc)과 같이 레퍼런스 응답에서 시작해 컷 1→4로 이어받는다.
      const chained = args.mode === "cover-ref-chain";
      reqs.push({
        file: `cut-${i}`,
        kind: "cut",
        cutIndex: i,
        prompt: build(cutOf(i), { referenceImage: true, ...(chained ? { continuesChain: true } : {}) }),
        attach: withSheet(i, [sheetUri, "reference"]),
        prev: chained ? (i === 1 ? "reference" : `cut-${i - 1}`) : null,
        note: `컷 ${i}`,
      });
    }
  } else {
    // A·A´·D: 표지 3안(첨부 [시트, ...style_refs]) → 고른 안이 컷 1 → 컷 2~4 이어받기.
    const cut1 = cutOf(1);
    coverDirectionsForMode(cut1).forEach((d, k) => {
      const variantCut = { ...cut1, shot_type: d.shot_type ?? cut1.shot_type, camera_angle: d.camera_angle ?? cut1.camera_angle, direction_note: undefined };
      reqs.push({ file: `cover-${k + 1}`, kind: "cover", prompt: build(variantCut, {}), attach: firstAttach, prev: null, note: `표지 ${k + 1}안` });
    });
    const picked = `cover-${args.coverPick}`;
    for (const i of [2, 3, 4]) {
      const base =
        args.mode === "cover-fixed" ? [sheetUri, picked] : args.mode === "chain-nostyle" ? [sheetUri] : [sheetUri, ...styleUris];
      reqs.push({
        file: `cut-${i}`,
        kind: "cut",
        cutIndex: i,
        prompt: build(cutOf(i), { continuesChain: true, ...(args.mode === "cover-fixed" ? { referenceImage: true } : {}) }),
        attach: withSheet(i, base),
        prev: i === 2 ? picked : `cut-${i - 1}`,
        note: `컷 ${i}`,
      });
    }
  }

  // ── 점검 ──
  const checks: [string, boolean][] = [];
  const covers = reqs.filter((r) => r.kind === "cover");
  const cutReqs = reqs.filter((r) => r.kind === "cut");
  const reference = reqs.find((r) => r.kind === "reference");
  const pairs = covers.map((r) => framingCamera(r.prompt));
  if (args.mode === "cover-fixed") checks.push(["D: 표지 3안 모두 bust·eye 같은 구도", new Set(pairs).size === 1]);
  else if (!refMode) checks.push(["표지 3안 (Framing, Camera) 조합이 3종", new Set(pairs).size === 3]);
  const raws = parseSubjectTags(storyboard.subject ?? "").map((t) => normalizeTagText(t.raw)).filter(Boolean);
  const leaked = reqs.filter((r) => raws.some((w) => normalizeTagText(r.prompt).includes(w))).length;
  checks.push([`소재 [태그] 원문 0회(${reqs.length}개 프롬프트 전부)`, leaked === 0]);
  const noted = reqs.filter((r) => r.prompt.includes("Director's note:"));
  if (args.note !== undefined) {
    checks.push([`메모가 지정 컷(컷 ${args.noteCut}) 프롬프트에만`, noted.length === 1 && noted[0].cutIndex === args.noteCut]);
  }
  checks.push(["체인 문장 = 이어받는 컷에만", reqs.every((r) => r.prompt.includes(CHAIN) === (r.prev !== null && !noPeople(r.cutIndex ?? 0)))]);
  const refImageExpected = refMode || args.mode === "cover-fixed";
  checks.push([
    `레퍼런스 안내 문장 = ${refImageExpected ? "모든 컷에" : "없음"}`,
    cutReqs.every((r) => r.prompt.includes(REF_IMAGE) === refImageExpected) && [...covers, ...(reference ? [reference] : [])].every((r) => !r.prompt.includes(REF_IMAGE)),
  ]);
  if (reference) {
    checks.push([
      "레퍼런스: 기준 그림 문장 있음·말풍선 자리 없음·bust·eye",
      reference.prompt.includes(REF_PANEL) && !reference.prompt.includes(ZONE) && framingCamera(reference.prompt) === framingCamera(build({ cut_index: 0, shot_type: "bust", camera_angle: "eye" }, {})),
    ]);
  }
  checks.push(["레퍼런스 외 요청에 기준 그림 문장 0", reqs.every((r) => r.kind === "reference" || !r.prompt.includes(REF_PANEL))]);
  for (const r of noted) {
    const p = r.prompt;
    const iNote = p.indexOf("Director's note:");
    const anchor = p.indexOf("Camera:") >= 0 ? p.indexOf("Camera:") : p.indexOf("Framing:");
    const iBubble = p.indexOf("No speech bubbles.");
    const iDoNot = p.indexOf("Do not include:");
    checks.push([
      "메모가 Framing·Camera 뒤, 고정 규칙 앞에",
      anchor >= 0 && iNote > anchor && iBubble >= 0 && iNote < iBubble && (iDoNot < 0 || iNote < iDoNot),
    ]);
  }

  // ── 저장 ──
  mkdirSync(out, { recursive: true });
  const manifest = {
    session: args.session,
    mode: args.mode,
    refStyle: args.refStyle ? "on" : "off",
    ...(refMode ? {} : { coverPick: args.coverPick }),
    dryRun: !args.run,
    model: RESPONSES_MODEL,
    size: IMAGE_SIZE,
    requests: reqs.map((r) => ({ file: r.file, attach: r.attach, previous_response_id: r.prev, framing_camera: framingCamera(r.prompt) })),
    cuts: [1, 2, 3, 4].map((i) => ({
      cut_index: i,
      shot_type: cutOf(i).shot_type,
      camera_angle: cutOf(i).camera_angle,
      direction_note: cutOf(i).direction_note ?? null,
    })),
  };
  writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const r of reqs) {
    writeFileSync(
      path.join(out, `${r.file}.txt`),
      `${r.note}, mode=${args.mode}, attach=${r.attach.join(",")}, prev=${r.prev ?? "없음"}\n\n${r.prompt}\n`
    );
  }

  // ── 출력 ──
  console.log("--- 요청별 첨부·이어받기·구도");
  for (const r of reqs) console.log(`  ${r.file}: [${r.attach.join(", ")}] prev=${r.prev ?? "없음"} · ${framingCamera(r.prompt).slice(0, 60)}`);
  for (const r of noted) console.log(`--- 메모 문장: ${r.prompt.match(/Director's note: (.+?)\./)?.[0]}`);
  let failed = 0;
  for (const [name, pass] of checks) {
    if (pass) console.log(`ok   ${name}`);
    else {
      failed++;
      console.error(`FAIL ${name}`);
    }
  }
  writeFileSync(
    path.join(out, "result.md"),
    [
      `# #326 컷 참조 비교 (${args.run ? `세션 ${args.session}` : "--dry-run"}, 모드 ${args.mode})`,
      "",
      ...reqs.map((r) => `- ${r.file}: [${r.attach.join(", ")}] prev=${r.prev ?? "없음"}`),
      `- 메모: ${args.note !== undefined ? `컷 ${args.noteCut}에 "${args.note}"` : "없음"}`,
      `- 점검: ${checks.filter(([, p]) => p).length}/${checks.length} 통과`,
      ...checks.map(([name, pass]) => `  - ${pass ? "ok" : "FAIL"} ${name}`),
      "",
    ].join("\n")
  );

  if (!args.run) {
    console.log("--- --dry-run 확인");
    if (useFake) {
      console.log(`이미지 호출 0건, 가로챈 fetch ${requests.length}건:`);
      for (const r of requests) console.log(`  ${r}`);
      const uploads = requests.filter((r) => /^(POST|PUT) [^ ]*\/storage\/v1\/object\//.test(r)).length;
      console.log(`Storage 업로드(쓰기) 요청: ${uploads}건`);
    } else {
      console.log(`실제 세션 읽기(getSession·getPreset·readAsset) 수행, 이미지 호출 0건 — 쓰기 없음`);
    }
    console.log(`완료: ${out}/ (manifest.json, result.md, *.txt — PNG 없음)`);
    if (failed > 0) {
      console.error(`중단: 점검 ${failed}건 실패`);
      process.exit(1);
    }
    return;
  }
  if (failed > 0) throw new Error(`점검 ${failed}건 실패 — 유료 생성을 하지 않습니다`);

  // ── --run (유료) ──
  // SDK 자동 재시도를 끈다(maxRetries 0) — 실제 HTTP 생성 시도는 요청 목록 장수로 고정돼
  // 상한(MAX_IMAGES 8)을 넘을 수 없다. 실패한 이미지는 재시도하지 않고 에러로 멈춘다.
  console.log(`OpenAI SDK 재시도 없음(maxRetries 0) — 실제 HTTP 생성 시도 최대 ${reqs.length}회`);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  // 첨부 라벨(애셋 URI 또는 앞 요청 파일 라벨) → input_image. 앞 요청 그림은 생성 뒤에 채운다.
  const imageByLabel = new Map<string, { type: "input_image"; image_url: string }>();
  for (const uri of firstAttach) {
    const buf = await loaded.readAsset(uri);
    if (!buf) {
      console.error(`reference 애셋을 읽지 못했습니다: ${uri}`);
      continue;
    }
    imageByLabel.set(uri, { type: "input_image", image_url: `data:image/png;base64,${buf.toString("base64")}` });
  }
  if (!sheetUri || !imageByLabel.has(sheetUri)) throw new Error("캐릭터 시트를 읽지 못해 생성하지 않습니다");
  const responseIdByLabel = new Map<string, string>();
  const qualityOpt = quality ? { quality } : {};
  const rows: string[] = [];

  async function send(r: Req): Promise<void> {
    const images = r.attach.map((l) => {
      const img = imageByLabel.get(l);
      if (!img) throw new Error(`${r.file}: 첨부 ${l} 를 준비하지 못했습니다`);
      return img;
    });
    const previous = r.prev ? responseIdByLabel.get(r.prev) : undefined;
    if (r.prev && !previous) throw new Error(`${r.file}: 이어받을 ${r.prev} 응답이 없습니다`);
    const started = performance.now();
    const response = await client.responses.create({
      model: RESPONSES_MODEL,
      ...(previous ? { previous_response_id: previous } : {}),
      input: [{ role: "user", content: [{ type: "input_text", text: r.prompt }, ...images] }],
      tools: [{ type: "image_generation", size: IMAGE_SIZE, ...qualityOpt }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const output = (response as { output?: { type?: string; result?: string }[] }).output ?? [];
    const result = output.find((o) => o.type === "image_generation_call")?.result;
    if (!result) throw new Error(`${r.file} 응답에 image_generation_call 결과가 없습니다`);
    writeFileSync(path.join(out, `${r.file}.png`), Buffer.from(result, "base64"));
    responseIdByLabel.set(r.file, (response as { id: string }).id);
    imageByLabel.set(r.file, { type: "input_image", image_url: `data:image/png;base64,${result}` });
    rows.push(`| ${r.file}.png | ${r.note} · ${framingCamera(r.prompt).slice(0, 40)} · [${r.attach.join(", ")}] prev=${r.prev ?? "없음"} | ${seconds}s | |`);
    console.log(`[${r.file}] ${seconds}s`);
  }

  const startedAll = performance.now();
  // 표지 3안·레퍼런스를 먼저(순서대로), 그다음 컷. C는 컷 1~4를 동시에(앞 컷 의존 없음), 나머지는
  // 이어받기 순서대로 하나씩 보낸다.
  for (const r of reqs.filter((x) => x.kind !== "cut")) await send(r);
  if (args.mode === "cover-ref") await Promise.all(cutReqs.map(send));
  else for (const r of cutReqs) await send(r);
  const totalSeconds = ((performance.now() - startedAll) / 1000).toFixed(1);

  writeFileSync(
    path.join(out, "result.md"),
    [
      `# #326 컷 참조 비교 (세션 ${args.session}, 모드 ${args.mode})`,
      "",
      `- 이미지 ${reqs.length}장, 전체 ${totalSeconds}s`,
      "- 판정: 컷 사이 얼굴·피부색·옷·머리색이 같은 인물인가, 요청한 구도·앵글로 보이는가",
      "",
      "| 파일 | 요청 | 걸린 시간 | 판정 |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n")
  );
  console.log(`완료: ${out}/ (manifest.json, result.md, *.txt/png) 전체 ${totalSeconds}s`);
}

main().catch((err) => {
  console.error(`중단: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
