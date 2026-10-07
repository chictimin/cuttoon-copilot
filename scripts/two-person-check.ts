/**
 * #242 2인 컷 좌우 배치 유료 확인 스크립트. 실행은 사용자가 한다.
 *
 * 기존 세션 하나의 캐릭터 시트·preset·스토리보드를 읽어, 주인공 1명 컷을 복사해 대비가 큰
 * 고정 조연을 [1] 로 넣은 2인 컷을 만들고, 실제 생성 경로와 같은 프롬프트(buildCutPrompt)로
 * 이미지를 n장(상한 3) 만든다. "왼쪽 = 주인공(characters_in_frame[0])" 이 지켜지는지 사람이 본다.
 *
 * - DB·Storage 쓰기 0. 세션·preset 은 getSession·getPreset, 시트는 readAsset 으로 읽기만 한다.
 * - generate.ts 의 generateCut 은 결과를 uploadAsset(Storage 쓰기)하고, 그 앞 단계
 *   (callImageGeneration)는 export 돼 있지 않다. 제품 코드를 고치지 않으려고 같은 요청을 여기서
 *   재현한다 — 모델(gpt-5 + image_generation)·크기(OUTPUT_SIZE)·quality(imageQuality)·reference
 *   (시트 + style_refs, 생성 화면 referenceAssetsOf 와 같은 순서)·프롬프트(buildCutPrompt 출력 그대로).
 *   체이닝(previous_response_id)은 없다 — 앞 컷 응답이 없는 단독 1장 확인이다.
 * - `--yes` 가 없으면 계획만 출력하고 DB 에 닿기 전에 끝난다.
 *
 * 실행(유료, 원본 폴더에서):
 *   npx tsx --env-file=.env --conditions=react-server scripts/two-person-check.ts --session <세션 id> --yes
 * 가짜 실행(유료 0, .env·네트워크 없음):
 *   npx tsx --conditions=react-server scripts/two-person-check.ts --dry --session fake
 *
 * 옵션: --n <1~3>(기본 3) · --out <폴더>(기본 .two-person-check/, Git 제외) · --dry · --yes
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { imageQuality, imageSetting } from "../lib/openai/image-setting";
import { getSupportingDefault } from "../lib/llm/cut-defaults";
import { normalizeTagText, parseSubjectTags } from "../lib/llm/subject-tags";
// generate.ts 는 불러오는 순간 OpenAI·Supabase 환경변수를 요구한다(모듈 최상위 클라이언트).
// --dry 가 가짜 값을 깐 뒤, 실제 실행은 --yes 확인 뒤에 동적으로 불러온다.

const MAX_IMAGES = 3; // 사용자 승인 상한. 인자로 늘릴 수 없다.
const RESPONSES_MODEL = "gpt-5"; // generate.ts RESPONSES_MODEL 과 같은 값
// generate.ts OUTPUT_SIZE(1024×1024)와 같은 값. 불러온 뒤 같은지 다시 확인한다.
const IMAGE_SIZE = "1024x1024";
const CHECK_SUPPORTING = {
  character_id: "check_sup",
  role: "supporting",
  description: "20대 여성 회사원, 긴 갈색 머리, 남색 정장",
} as const;

interface Args {
  session: string;
  n: number;
  out: string;
  dry: boolean;
  yes: boolean;
}

type CastMember = { character_id?: string; role?: string; description?: string };
type FrameMember = { character_id?: string; expression?: string; pose?: string };
type Cut = { cut_index?: number; characters_in_frame?: FrameMember[]; generated_image?: string | null; [k: string]: unknown };
type Storyboard = { subject?: string; cast?: CastMember[]; cuts?: Cut[]; subject_tags?: unknown; [k: string]: unknown };
type Preset = { assets?: { character_sheet?: string; style_refs?: string[] }; [k: string]: unknown };

interface Loaded {
  storyboard: Storyboard;
  preset: Preset;
  readAsset: (uri: string) => Promise<Buffer | null>;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const session = get("--session");
  if (!session) throw new Error("--session <세션 id> 가 필요합니다");
  const n = Number(get("--n") ?? String(MAX_IMAGES));
  if (!Number.isInteger(n) || n < 1 || n > MAX_IMAGES) {
    throw new Error(`--n 은 1~${MAX_IMAGES} 사이여야 합니다(받음: ${get("--n")}) — 승인 상한 ${MAX_IMAGES}장`);
  }
  return { session, n, out: get("--out") ?? ".two-person-check", dry: argv.includes("--dry"), yes: argv.includes("--yes") };
}

async function loadReal(sessionId: string): Promise<Loaded> {
  // 동적 import: --dry 와 --yes 없는 실행에서는 DB 모듈을 불러오지 않는다.
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
    shot_type: "medium",
    camera_angle: "eye_level",
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

// 주인공 1명 컷(컷 2 우선)을 복사해 [1] 에 고정 조연을 넣는다. 원본 스토리보드는 고치지 않는다.
function makeTwoPersonCut(storyboard: Storyboard): { storyboard: Storyboard; cut: Cut } {
  const cuts = storyboard.cuts ?? [];
  const solo = (c: Cut) => (c.characters_in_frame?.length ?? 0) === 1 && c.characters_in_frame?.[0]?.character_id === "protagonist";
  const base = cuts.find((c) => c.cut_index === 2 && solo(c)) ?? cuts.find((c) => (c.cut_index ?? 0) >= 2 && solo(c));
  if (!base) throw new Error("주인공 1명만 나오는 컷(2~4번)을 찾지 못했습니다");
  const sup = getSupportingDefault();
  const cut: Cut = {
    ...base,
    characters_in_frame: [
      { ...base.characters_in_frame![0] },
      { character_id: CHECK_SUPPORTING.character_id, expression: sup.expression, pose: sup.pose },
    ],
    generated_image: null,
  };
  const cast = [...(storyboard.cast ?? []).filter((m) => m.character_id !== CHECK_SUPPORTING.character_id), { ...CHECK_SUPPORTING }];
  return { storyboard: { ...storyboard, cast, cuts: cuts.map((c) => (c === base ? cut : c)) }, cut };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const setting = imageSetting();
  if (setting === "comfyui") throw new Error("이 확인은 OpenAI 이미지로 한다 — IMAGE_PROVIDER 를 비우거나 openai 로 두세요");
  const quality = imageQuality(setting);

  console.log(
    `${args.dry ? "[--dry, 가짜 응답 · 과금 0] " : ""}유료 이미지 ${args.n}장 생성 — 모델 ${RESPONSES_MODEL} + image_generation, ` +
      `크기 ${IMAGE_SIZE}, 품질 ${quality ?? "기본(지정 안 함)"} (IMAGE_PROVIDER=${setting}), 체이닝 없음, 결과 ${args.out}/`
  );
  if (!args.dry && !args.yes) {
    console.log("--yes 가 없어 생성하지 않고 끝냅니다. 위 내용이 맞으면 --yes 를 붙여 다시 실행하세요.");
    return;
  }

  // --dry: 모든 fetch 를 가로채 외부로 나가지 않게 한다. OpenAI 클라이언트가 만들어지기 전에 바꾼다.
  const requests: string[] = [];
  const sentPrompts: string[] = [];
  if (args.dry) {
    process.env.SUPABASE_URL = "https://demo.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "demo";
    const fakePng = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#dddddd" } }).png().toBuffer();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      requests.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
      if (url.host === "api.openai.com" && typeof init?.body === "string") {
        sentPrompts.push(JSON.parse(init.body).input[0].content[0].text);
        return new Response(
          JSON.stringify({ id: `resp_dry_${requests.length}`, output: [{ type: "image_generation_call", result: fakePng.toString("base64") }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }
  if (args.dry) process.env.OPENAI_API_KEY = "sk-dry-fake";
  const { OUTPUT_SIZE, buildCutPrompt } = await import("../lib/openai/generate");
  if (`${OUTPUT_SIZE.width}x${OUTPUT_SIZE.height}` !== IMAGE_SIZE) throw new Error("OUTPUT_SIZE 가 바뀌었습니다 — 이 스크립트의 IMAGE_SIZE 를 맞추세요");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const loaded = args.dry ? await loadDry() : await loadReal(args.session);
  const { storyboard, cut } = makeTwoPersonCut(loaded.storyboard);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prompt = buildCutPrompt(storyboard as any, loaded.preset as any, cut as any);

  // 생성 전 점검: 좌우 라벨 각 1회, 소재 [태그] 원문 0회. 어긋나면 과금 전에 멈춘다.
  const count = (sub: string) => prompt.split(sub).length - 1;
  const left = count("Character on the left side of the panel:");
  const right = count("Character on the right side of the panel:");
  const raws = parseSubjectTags(storyboard.subject ?? "").map((t) => normalizeTagText(t.raw)).filter(Boolean);
  const leaked = raws.filter((r) => normalizeTagText(prompt).includes(r)).length;
  if (left !== 1 || right !== 1 || leaked > 0) {
    throw new Error(`프롬프트 점검 실패 — 왼쪽 라벨 ${left}회, 오른쪽 라벨 ${right}회, 소재 원문 ${leaked}개`);
  }

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
  if (images.length === 0) throw new Error("캐릭터 시트를 읽지 못해 생성하지 않습니다(테스트 DB 정리 뒤라면 시트가 없을 수 있음)");

  mkdirSync(args.out, { recursive: true });
  writeFileSync(path.join(args.out, "prompt.txt"), `${prompt}\n`);

  const rows: string[] = [];
  for (let i = 1; i <= args.n; i++) {
    const started = performance.now();
    const response = await client.responses.create({
      model: RESPONSES_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...images] }],
      tools: [{ type: "image_generation", size: IMAGE_SIZE, ...(quality && { quality }) }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const output = (response as { output?: { type?: string; result?: string }[] }).output ?? [];
    const result = output.find((o) => o.type === "image_generation_call")?.result;
    if (!result) throw new Error(`${i}번째 응답에 image_generation_call 결과가 없습니다`);
    const file = `two-person-${i}.png`;
    writeFileSync(path.join(args.out, file), Buffer.from(result, "base64"));
    rows.push(`| ${file} | ${seconds}s | | |`);
    console.log(`[${i}/${args.n}] ${file} ${seconds}s`);
  }

  writeFileSync(
    path.join(args.out, "result.md"),
    [
      `# #242 2인 컷 좌우 확인 (${args.dry ? "--dry 가짜" : `세션 ${args.session}`})`,
      "",
      `- 컷 ${cut.cut_index} 복사, [0] 주인공 · [1] 고정 조연(${CHECK_SUPPORTING.description})`,
      `- 모델 ${RESPONSES_MODEL} + image_generation, ${IMAGE_SIZE}, 품질 ${quality ?? "기본"}, 체이닝 없음`,
      "- 판정: 왼쪽에 주인공, 오른쪽에 조연이면 ✅",
      "",
      "| 파일 | 걸린 시간 | 왼쪽 = 주인공? | 메모 |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n")
  );

  if (args.dry) {
    console.log("--- --dry 확인");
    console.log(`보낸 프롬프트 ${sentPrompts.length}건, buildCutPrompt 출력과 바이트 동일: ${sentPrompts.every((p) => p === prompt)}`);
    console.log(`가로챈 요청 ${requests.length}건:`);
    for (const r of requests) console.log(`  ${r}`);
    // 업로드 = Storage object 에 대한 POST·PUT. asset-store 가 불러올 때 하는 버킷 설정 읽기(GET bucket)는 읽기다.
    const uploads = requests.filter((r) => /^(POST|PUT) [^ ]*\/storage\/v1\/object\//.test(r)).length;
    console.log(`Storage 업로드(쓰기) 요청: ${uploads}건`);
  }
  console.log(`완료: ${args.out}/ (prompt.txt, result.md, PNG ${args.n}장)`);
}

main().catch((err) => {
  console.error(`중단: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
