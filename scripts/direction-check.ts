/**
 * #325 연출 반영 POC 확인 스크립트. 유료 실행은 사람이 한다.
 *
 * 기존 세션 하나의 스토리보드·preset·시트를 읽어, 컷 2~4에 서로 다른 연출을
 * 지정하고(기본 2 full·eye / 3 closeup·high / 4 wide·low), 표지 3안(안별 구도
 * 분리 적용)과 컷 2~4 체이닝(실제와 같은 previous_response_id)으로 이미지를
 * 만든다. "구도·앵글·연출 메모를 바꾸면 그림이 실제로 달라지는가" 를 사람이 본다.
 *
 * - DB·Storage 쓰기 0. 세션·preset 은 getSession·getPreset, 시트는 readAsset 으로 읽기만 한다.
 * - generate.ts 의 generateCoverVariants·generateCut 은 결과를 uploadAsset(Storage 쓰기)하고,
 *   그 앞 단계(callImageGeneration)는 export 돼 있지 않다. 제품 코드를 고치지 않으려고 같은
 *   요청을 여기서 재현한다 — 모델(gpt-5 + image_generation)·크기(OUTPUT_SIZE)·quality
 *   (imageQuality)·reference(시트 + style_refs, 생성 화면 referenceAssetsOf 와 같은 순서)·
 *   프롬프트(buildCutPrompt 출력 그대로, 표지는 coverVariantDirections 배정 그대로).
 *   컷 2~4 체이닝(previous_response_id)은 실제 흐름과 같다 — 표지 1안 응답 → 컷 2 → 컷 3 → 컷 4.
 * - **기본은 --dry-run**: 이미지 호출 0, 프롬프트만 출력·저장한다. 유료 생성은 --run 을
 *   명시했을 때만 나간다. 1회 실행 최대 이미지 8장(MAX_IMAGES), 넘으면 거부한다.
 *   --run의 OpenAI 클라이언트는 maxRetries 0이라 SDK 자동 재시도가 없어 실제 HTTP 생성
 *   시도는 표지 3 + 컷 3 = 최대 6회로 고정된다.
 * - --dry-run에 실제 세션 id를 주면 DB 읽기(getSession·getPreset·시트 readAsset)는 실제로
 *   한다. 쓰기(uploadAsset·이미지 호출)는 dry-run 경로에 없어 0이 보장된다.
 *   세션을 생략하면 내장 fake로 돌며 그때만 외부 요청을 전부 가로챈다(.env·네트워크 없음).
 *
 * 실행(유료, 원본 폴더에서):
 *   npx tsx --env-file=.env --conditions=react-server scripts/direction-check.ts --session <세션 id> --run
 * 실제 세션 프롬프트만(유료 0, DB 읽기만):
 *   npx tsx --env-file=.env --conditions=react-server scripts/direction-check.ts --session <세션 id> --dry-run
 * 프롬프트만(유료 0, .env·네트워크 없음):
 *   npx tsx --conditions=react-server scripts/direction-check.ts --dry-run
 *
 * 옵션: --session <id>(--run 필수, --dry-run은 생략 시 fake) · --cut2/--cut3/--cut4 <shot,angle> ·
 *   --note "<문장>" · --note-cut <2|3|4, 기본 3> · --out <폴더>(기본 tmp/direction-check, 아래 시각 하위폴더) ·
 *   --dry-run(기본) · --run
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { imageQuality, imageSetting } from "../lib/openai/image-setting";
import { normalizeTagText, parseSubjectTags } from "../lib/llm/subject-tags";
// generate.ts 는 불러오는 순간 OpenAI·Supabase 환경변수를 요구한다(모듈 최상위 클라이언트).
// --dry-run 이 가짜 값을 깐 뒤, 실제 실행은 --run 확인 뒤에 동적으로 불러온다.

const MAX_IMAGES = 8; // 1회 실행 상한. 표지 3안 + 컷 2~4(3장) = 6장이라 기본 구성은 항상 안쪽이다.
const RESPONSES_MODEL = "gpt-5"; // generate.ts RESPONSES_MODEL 과 같은 값
// generate.ts OUTPUT_SIZE(1024×1024)와 같은 값. 불러온 뒤 같은지 다시 확인한다.
const IMAGE_SIZE = "1024x1024";
// --dry-run + --session 생략(fake) 때 쓰는 기본 연출 메모. 소재 [태그] 원문을 일부러
// 넣어 브랜드 투영(projectForModel)이 메모에도 걸리는지 같이 본다.
const FAKE_NOTE = "손에 [블루핏 앱]을 들고 환하게 웃기";

interface Args {
  session: string;
  cutSpecs: Record<2 | 3 | 4, { shot: string; angle: string }>;
  note: string | undefined;
  noteCut: 2 | 3 | 4;
  outBase: string;
  run: boolean;
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

function parseCutSpec(raw: string | undefined, name: string): { shot: string; angle: string } {
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
  return {
    session,
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
    preset: { style: { line_weight: "medium", saturation: "pastel", character_ratio: "2.5head" }, assets: { character_sheet: "asset://dry-sheet", style_refs: [] } },
    readAsset: async (uri) => (uri === "asset://dry-sheet" ? sheet : null),
  };
}

// 컷 2~4에 서로 다른 연출을 지정한 복사본을 만든다. 원본 스토리보드는 고치지 않는다.
function applyDirection(
  storyboard: Storyboard,
  cutSpecs: Args["cutSpecs"],
  note: string | undefined,
  noteCut: 2 | 3 | 4
): { storyboard: Storyboard; cuts: Record<2 | 3 | 4, Cut> } {
  const cuts = storyboard.cuts ?? [];
  const out: Partial<Record<2 | 3 | 4, Cut>> = {};
  for (const index of [2, 3, 4] as const) {
    const base = cuts.find((c) => c.cut_index === index);
    if (!base) throw new Error(`컷 ${index}를 찾지 못했습니다`);
    out[index] = {
      ...base,
      shot_type: cutSpecs[index].shot,
      camera_angle: cutSpecs[index].angle,
      ...(index === noteCut && note !== undefined ? { direction_note: note } : {}),
      generated_image: null,
    };
  }
  const replaced = cuts.map((c) => {
    const hit = (Object.values(out) as Cut[]).find((o) => o.cut_index === c.cut_index);
    return hit ?? c;
  });
  return { storyboard: { ...storyboard, cuts: replaced }, cuts: out as Record<2 | 3 | 4, Cut> };
}

function framingCamera(prompt: string): { framing: string | undefined; camera: string | undefined } {
  return {
    framing: prompt.match(/Framing: (.+?)\./)?.[1],
    camera: prompt.match(/Camera: (.+?)\./)?.[1],
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const setting = imageSetting();
  if (setting === "comfyui") throw new Error("이 확인은 OpenAI 이미지로 한다 — IMAGE_PROVIDER 를 비우거나 openai 로 두세요");
  const quality = imageQuality(setting);
  const totalImages = 3 + 3; // 표지 3안 + 컷 2~4
  if (totalImages > MAX_IMAGES) throw new Error(`1회 ${totalImages}장은 상한(${MAX_IMAGES}장)을 넘겨 거부합니다`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(args.outBase, stamp);

  console.log(
    `${args.run ? "[--run, 유료] " : "[--dry-run, 이미지 호출 0] "}표지 3안 + 컷 2~4 체이닝 — 모델 ${RESPONSES_MODEL} + image_generation, ` +
      `크기 ${IMAGE_SIZE}, 품질 ${quality ?? "기본(지정 안 함)"} (IMAGE_PROVIDER=${setting}), 결과 ${out}/`
  );
  console.log(
    `연출: 컷 2 ${args.cutSpecs[2].shot}·${args.cutSpecs[2].angle} / 컷 3 ${args.cutSpecs[3].shot}·${args.cutSpecs[3].angle} / ` +
      `컷 4 ${args.cutSpecs[4].shot}·${args.cutSpecs[4].angle}` +
      (args.note !== undefined ? ` / 메모(컷 ${args.noteCut}): ${args.note}` : " / 메모 없음")
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
  const { OUTPUT_SIZE, buildCutPrompt, coverVariantDirections } = await import("../lib/openai/generate");
  if (`${OUTPUT_SIZE.width}x${OUTPUT_SIZE.height}` !== IMAGE_SIZE) throw new Error("OUTPUT_SIZE 가 바뀌었습니다 — 이 스크립트의 IMAGE_SIZE 를 맞추세요");

  const loaded = args.session === "fake" ? await loadDry() : await loadReal(args.session);
  if (args.session === "fake" && args.run) throw new Error("--run 실행은 실제 세션이 필요합니다");
  const { storyboard, cuts } = applyDirection(loaded.storyboard, args.cutSpecs, args.note, args.noteCut);
  const cut1 = (loaded.storyboard.cuts ?? []).find((c) => c.cut_index === 1);

  // 표지 3안 프롬프트 — 유료 경로(generateCoverVariants)와 같은 배정 함수를 쓴다(재현이 아니라 호출).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directions = coverVariantDirections(cut1 as any);
  const coverPrompts = directions.map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const variantCut = { ...(cut1 ?? { cut_index: 1 }), shot_type: d.shot_type, camera_angle: d.camera_angle } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return buildCutPrompt(loaded.storyboard as any, loaded.preset as any, variantCut);
  });
  // 컷 2~4 프롬프트 — 실제와 같이 체이닝 표시(continuesChain)를 켠다.
  const cutPrompts = ([2, 3, 4] as const).map((i) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buildCutPrompt(storyboard as any, loaded.preset as any, cuts[i] as any, { continuesChain: true })
  );

  // ── 점검 ──
  const checks: [string, boolean][] = [];
  const pairs = coverPrompts.map((p) => {
    const { framing, camera } = framingCamera(p);
    return `${framing ?? "?"} / ${camera ?? "?"}`;
  });
  checks.push(["표지 3안 (Framing, Camera) 조합이 3종", new Set(pairs).size === 3]);
  const raws = parseSubjectTags(storyboard.subject ?? "").map((t) => normalizeTagText(t.raw)).filter(Boolean);
  const allPrompts = [...coverPrompts, ...cutPrompts];
  const leaked = allPrompts.filter((p) => raws.some((r) => normalizeTagText(p).includes(r))).length;
  checks.push(["소재 [태그] 원문 0회(6개 프롬프트 전부)", leaked === 0]);
  const noted = allPrompts.filter((p) => p.includes("Director's note:"));
  if (args.note !== undefined) {
    checks.push([`메모가 지정 컷(컷 ${args.noteCut}) 프롬프트에만`, noted.length === 1 && cutPrompts[args.noteCut - 2].includes("Director's note:")]);
  }
  for (const p of noted) {
    const iNote = p.indexOf("Director's note:");
    const iCamera = p.indexOf("Camera:");
    const iFraming = p.indexOf("Framing:");
    const iBubble = p.indexOf("No speech bubbles.");
    const iDoNot = p.indexOf("Do not include:");
    const anchor = iCamera >= 0 ? iCamera : iFraming;
    checks.push([
      "메모가 Framing·Camera 뒤, 고정 규칙 앞에",
      anchor >= 0 && iNote > anchor && iBubble >= 0 && iNote < iBubble && (iDoNot < 0 || iNote < iDoNot),
    ]);
  }

  // ── 저장 ──
  mkdirSync(out, { recursive: true });
  const manifest = {
    session: args.session,
    dryRun: !args.run,
    model: RESPONSES_MODEL,
    size: IMAGE_SIZE,
    cover: directions.map((d, i) => ({ variant: i + 1, shot_type: d.shot_type, camera_angle: d.camera_angle })),
    cuts: ([2, 3, 4] as const).map((i) => ({
      cut_index: i,
      shot_type: cuts[i].shot_type,
      camera_angle: cuts[i].camera_angle,
      direction_note: cuts[i].direction_note ?? null,
    })),
  };
  writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  coverPrompts.forEach((p, i) => {
    const d = directions[i];
    writeFileSync(path.join(out, `cover-${i + 1}.txt`), `variant: ${i + 1}, shot_type=${d.shot_type}, camera_angle=${d.camera_angle}\n\n${p}\n`);
  });
  cutPrompts.forEach((p, k) => {
    const i = [2, 3, 4][k] as 2 | 3 | 4;
    writeFileSync(
      path.join(out, `cut-${i}.txt`),
      `cut: ${i}, shot_type=${cuts[i].shot_type}, camera_angle=${cuts[i].camera_angle}, note=${cuts[i].direction_note ?? "(없음)"}\n\n${p}\n`
    );
  });

  // ── 출력 ──
  console.log("--- 표지 3안 Framing/Camera");
  pairs.forEach((pair, i) => console.log(`  ${i + 1}안: ${pair}`));
  if (noted.length) {
    for (const p of noted) console.log(`--- 메모 문장: ${p.match(/Director's note: (.+?)\./)?.[0]}`);
  }
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
      `# #325 연출 확인 (${args.run ? `세션 ${args.session}` : "--dry-run"})`,
      "",
      `- 표지 3안: ${pairs.map((pair, i) => `${i + 1}안(${pair})`).join(" / ")}`,
      `- 컷 2~4: ${([2, 3, 4] as const).map((i) => `${i}(${cuts[i].shot_type}·${cuts[i].camera_angle})`).join(" / ")}`,
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
    console.log(`완료: ${out}/ (manifest.json, result.md, cover-*.txt, cut-*.txt — PNG 없음)`);
    if (failed > 0) {
      console.error(`중단: 점검 ${failed}건 실패`);
      process.exit(1);
    }
    return;
  }

  // ── --run (유료) ──
  // SDK 자동 재시도를 끈다(maxRetries 0) — 실제 HTTP 생성 시도는 표지 3 + 컷 3 = 최대 6회로
  // 고정돼 상한(MAX_IMAGES 8)을 넘을 수 없다. 실패한 이미지는 재시도하지 않고 에러로 멈춘다.
  console.log(`OpenAI SDK 재시도 없음(maxRetries 0) — 실제 HTTP 생성 시도 최대 ${totalImages}회`);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  // reference: 생성 화면(generate-client referenceAssetsOf)과 같은 [시트, ...style_refs], 중복 제거.
  const uris = [...new Set([loaded.preset.assets?.character_sheet, ...(loaded.preset.assets?.style_refs ?? [])])].filter(
    (u): u is string => typeof u === "string"
  );
  const images: { type: "input_image"; image_url: string }[] = [];
  for (const uri of uris) {
    const buf = await loaded.readAsset(uri);
    if (!buf) {
      console.error(`reference 애셋을 읽지 못했습니다: ${uri}`);
      continue;
    }
    images.push({ type: "input_image", image_url: `data:image/png;base64,${buf.toString("base64")}` });
  }
  if (images.length === 0) throw new Error("캐릭터 시트를 읽지 못해 생성하지 않습니다");
  const qualityOpt = quality ? { quality } : {};

  const rows: string[] = [];
  const coverIds: string[] = [];
  for (let i = 0; i < coverPrompts.length; i++) {
    const started = performance.now();
    const response = await client.responses.create({
      model: RESPONSES_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: coverPrompts[i] }, ...images] }],
      tools: [{ type: "image_generation", size: IMAGE_SIZE, ...qualityOpt }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const output = (response as { output?: { type?: string; result?: string }[] }).output ?? [];
    const result = output.find((o) => o.type === "image_generation_call")?.result;
    if (!result) throw new Error(`표지 ${i + 1}안 응답에 image_generation_call 결과가 없습니다`);
    const file = `cover-${i + 1}.png`;
    writeFileSync(path.join(out, file), Buffer.from(result, "base64"));
    coverIds.push((response as { id: string }).id);
    rows.push(`| ${file} | 표지 ${i + 1}안(${pairs[i]}) | ${seconds}s | |`);
    console.log(`[표지 ${i + 1}/3] ${file} ${seconds}s`);
  }

  // 컷 2~4 — 실제와 같은 previous_response_id 체이닝. 표지 1안 응답에서 이어받는다.
  let previous = coverIds[0];
  for (let k = 0; k < cutPrompts.length; k++) {
    const cutIndex = [2, 3, 4][k];
    const started = performance.now();
    const response = await client.responses.create({
      model: RESPONSES_MODEL,
      previous_response_id: previous,
      input: [{ role: "user", content: [{ type: "input_text", text: cutPrompts[k] }, ...images] }],
      tools: [{ type: "image_generation", size: IMAGE_SIZE, ...qualityOpt }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const output = (response as { output?: { type?: string; result?: string }[] }).output ?? [];
    const result = output.find((o) => o.type === "image_generation_call")?.result;
    if (!result) throw new Error(`컷 ${cutIndex} 응답에 image_generation_call 결과가 없습니다`);
    const file = `cut-${cutIndex}.png`;
    writeFileSync(path.join(out, file), Buffer.from(result, "base64"));
    previous = (response as { id: string }).id;
    const c = cuts[cutIndex as 2 | 3 | 4];
    rows.push(`| ${file} | 컷 ${cutIndex}(${c.shot_type}·${c.camera_angle}) | ${seconds}s | |`);
    console.log(`[컷 ${cutIndex}] ${file} ${seconds}s`);
  }

  writeFileSync(
    path.join(out, "result.md"),
    [
      `# #325 연출 확인 (세션 ${args.session})`,
      "",
      "- 판정: 연출(구도·앵글·메모)이 다르면 그림이 달라야 ✅",
      "",
      "| 파일 | 요청 연출 | 걸린 시간 | 다르게 나왔나 | 메모 |",
      "| --- | --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n")
  );
  console.log(`완료: ${out}/ (manifest.json, result.md, cover-*.txt/png, cut-*.txt/png)`);
}

main().catch((err) => {
  console.error(`중단: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
