/**
 * 발표용 데모 캐시(#239·#240) 만들기 도구.
 *
 * 골든패스를 한 바퀴 돈 세션 하나를 받아, 그 세션의 저장본 이미지 4장(컷 1 = 기준 컷 + 컷 2·3·4)을
 * public/demo-cache/ 바로 아래 PNG 로 내려받고 manifest.json 을 쓴다. 읽는 쪽은
 * lib/render/demo-cache.ts(manifestImageRefs·readDemoCacheImage)와 화면 데모 모드(demo-mode.ts)다.
 *
 * - 이미지를 만들지 않는다(생성 호출 0). 네트워크는 Supabase 읽기뿐이고 DB·Storage 에 쓰지 않는다.
 * - #326 프리뷰 흐름: 표지 3안 대신 기준 컷 1장이 컷 1이다. 화면 데모 모드는 manifest
 *   covers[cover_pick-1] 1장만 컷 1로 쓰므로 covers 는 저장본 컷 1 한 장(cover-1.png), cover_pick 1.
 * - 선택 기록(selections, cut_index 1)은 교차 확인용이다. 기준 컷은 후보 1장 라운드로 기록되고
 *   확정한 라운드가 selected 다. 마지막 selected 라운드의 selected_asset 이 컷 1과 다르면 점검 실패,
 *   기록이 없으면 경고만 내고 진행한다.
 * - 점검이 하나라도 어긋나면 파일을 하나도 쓰지 않고 종료 코드 1 로 끝난다.
 *
 * 실행(실제 세션, Supabase 읽기에 .env 가 필요하다):
 *   npx tsx --env-file=.env --conditions=react-server scripts/demo-cache-build.ts --session <세션 id>
 * 가짜 데이터로 흐름만(네트워크·.env 없음, 임시 폴더에 씀):
 *   npx tsx --conditions=react-server scripts/demo-cache-build.ts --dry --session fake
 *   --dry-case two-person | pick-mismatch | bad-size  → 점검 실패 시나리오
 *   --dry-case no-selection  → 선택 기록 없음(경고만, 통과)
 *
 * 옵션: --out <폴더>(기본 public/demo-cache, --dry 는 임시 폴더)
 */

import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// #240 확정 고정값. 소재는 sessions.subject(정본) 문자열과 글자 그대로 비교한다.
const EXPECTED_SUBJECT = "[리브라이블리 앱]으로 퇴근 후 10분 무릎 스트레칭";
const EXPECTED_SIZE = { width: 1024, height: 1024 } as const;
const COVER_FILES = ["cover-1.png"] as const;
const COVER_PICK = 1;
const CUT_FILES = { "2": "cut-2.png", "3": "cut-3.png", "4": "cut-4.png" } as const;
const MANIFEST_VERSION = 1;

interface Args {
  session: string;
  dry: boolean;
  dryCase?: "two-person" | "pick-mismatch" | "bad-size" | "no-selection";
  out?: string;
}

interface CutLike {
  cut_index?: number;
  characters_in_frame?: unknown[];
  generated_image?: string | null;
}

interface Loaded {
  projectId: string;
  subject: string;
  subjectTags: unknown;
  cuts: CutLike[];
  /** 마지막 selected 기준 컷(cut_index 1) 라운드. 없으면 null. */
  cover: { selectedAsset: string | null } | null;
  readAsset: (uri: string) => Promise<Buffer | null>;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const session = get("--session");
  if (!session) throw new Error("--session <세션 id> 가 필요합니다");
  const dryCase = get("--dry-case");
  if (dryCase && !["two-person", "pick-mismatch", "bad-size", "no-selection"].includes(dryCase)) {
    throw new Error(`--dry-case 는 two-person | pick-mismatch | bad-size | no-selection 중 하나입니다: ${dryCase}`);
  }
  return {
    session,
    dry: argv.includes("--dry"),
    dryCase: dryCase as Args["dryCase"],
    out: get("--out"),
  };
}

// --- 실제 세션 읽기(읽기 전용) ---
async function loadReal(sessionId: string): Promise<Loaded> {
  // 동적 import: --dry 에서는 DB 모듈을 아예 불러오지 않는다.
  const { getSession } = await import("../lib/db/sessions");
  const { getDb } = await import("../lib/db/client");
  const { readAsset } = await import("../lib/asset-store");

  const saved = await getSession(sessionId);
  if (!saved) throw new Error(`세션을 찾지 못했습니다: ${sessionId}`);

  // selections 를 읽는 함수가 lib/db 에 없어 여기서 한 번만 조회한다(읽기 전용 select).
  const { data, error } = await getDb()
    .from("selections")
    .select("round, selected_asset, outcome")
    .eq("session_id", sessionId)
    .eq("cut_index", 1)
    .eq("outcome", "selected")
    .order("round", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`기준 컷 선택 기록 조회 실패: ${error.message}`);

  const sb = saved.storyboard as unknown as { cuts?: CutLike[]; subject_tags?: unknown };
  return {
    projectId: saved.projectId,
    subject: saved.storyboard.subject,
    subjectTags: sb.subject_tags ?? null,
    cuts: sb.cuts ?? [],
    cover: data ? { selectedAsset: (data.selected_asset as string | null) ?? null } : null,
    readAsset,
  };
}

// --- 가짜 세션(--dry) ---
async function loadDry(args: Args): Promise<Loaded> {
  const png = (w: number, h: number, color: string) =>
    sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
  const assets = new Map<string, Buffer>();
  const colors = ["#f4a261", "#2a9d8f", "#e76f51", "#8ab17d"];
  const uris = colors.map((_, i) => `asset://dry-${i + 1}`);
  for (let i = 0; i < uris.length; i++) {
    const bad = args.dryCase === "bad-size" && i === 2;
    assets.set(uris[i], await png(bad ? 1536 : 1024, 1024, colors[i]));
  }
  const one = [{ character_id: "protagonist" }];
  const cuts: CutLike[] = [
    { cut_index: 1, characters_in_frame: one, generated_image: uris[0] },
    { cut_index: 2, characters_in_frame: one, generated_image: uris[1] },
    {
      cut_index: 3,
      characters_in_frame: args.dryCase === "two-person" ? [...one, { character_id: "supporting" }] : one,
      generated_image: uris[2],
    },
    { cut_index: 4, characters_in_frame: one, generated_image: uris[3] },
  ];
  // pick-mismatch: 선택 기록이 다른 후보(버린 기준 컷)를 확정한 것으로 남은 세션.
  const selectedAsset = args.dryCase === "pick-mismatch" ? "asset://dry-discarded" : uris[0];
  return {
    projectId: "dry-project",
    subject: EXPECTED_SUBJECT,
    subjectTags: [{ raw: "리브라이블리 앱", category: "건강 관리 앱" }],
    cuts,
    cover: args.dryCase === "no-selection" ? null : { selectedAsset },
    readAsset: async (uri) => assets.get(uri) ?? null,
  };
}

// --- 점검 ---
async function check(
  loaded: Loaded
): Promise<{ problems: string[]; warnings: string[]; files: Map<string, Buffer> }> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const files = new Map<string, Buffer>();

  if (loaded.subject !== EXPECTED_SUBJECT) problems.push("소재 문자열이 #240 고정값과 다릅니다");

  const cuts = [...loaded.cuts].sort((a, b) => (a.cut_index ?? 0) - (b.cut_index ?? 0));
  if (cuts.length !== 4) problems.push(`컷 수가 4가 아닙니다(${cuts.length})`);
  cuts.forEach((c) => {
    const n = c.characters_in_frame?.length ?? 0;
    if (n !== 1) problems.push(`컷 ${c.cut_index}: 등장 인물이 ${n}명입니다 — 조연 없음(1인)이어야 합니다`);
  });

  const cut1 = cuts.find((c) => c.cut_index === 1)?.generated_image;
  if (!loaded.cover) {
    warnings.push("기준 컷 선택 기록(selections, cut_index 1, selected)이 없습니다 — 저장본 컷 1을 그대로 씁니다");
  } else if (loaded.cover.selectedAsset !== cut1) {
    problems.push("선택 기록의 selected_asset 이 컷 1 이미지와 다릅니다(확정한 기준 컷이 아님)");
  }

  const wanted: [string, string | null | undefined][] = [
    [COVER_FILES[0], cut1],
    ...(Object.entries(CUT_FILES) as [keyof typeof CUT_FILES, string][]).map(
      ([idx, f]): [string, string | null | undefined] => [f, cuts.find((c) => String(c.cut_index) === idx)?.generated_image]
    ),
  ];
  for (const [file, uri] of wanted) {
    if (!uri || !uri.startsWith("asset://")) {
      problems.push(`${file}: asset:// 이미지가 없습니다(${uri ?? "비어 있음"})`);
      continue;
    }
    const buf = await loaded.readAsset(uri);
    if (!buf) {
      problems.push(`${file}: ${uri} 를 읽지 못했습니다`);
      continue;
    }
    const meta = await sharp(buf).metadata().catch(() => undefined);
    if (meta?.format !== "png" || meta.width !== EXPECTED_SIZE.width || meta.height !== EXPECTED_SIZE.height) {
      problems.push(`${file}: ${meta?.format ?? "?"} ${meta?.width ?? "?"}×${meta?.height ?? "?"} — 1024×1024 PNG 여야 합니다`);
      continue;
    }
    files.set(file, buf);
  }
  return { problems, warnings, files };
}

function kstDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.dry) {
    // 가짜 실행이 실수로라도 실제 저장소에 닿지 않게 주소를 덮어쓴다.
    process.env.SUPABASE_URL = "https://demo.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "demo";
  }
  const outDir = args.out ?? (args.dry ? mkdtempSync(path.join(tmpdir(), "demo-cache-dry-")) : "public/demo-cache");

  const loaded = args.dry ? await loadDry(args) : await loadReal(args.session);
  const { problems, warnings, files } = await check(loaded);
  for (const w of warnings) console.warn(`경고: ${w}`);
  if (problems.length) {
    console.error("점검 실패 — 파일을 쓰지 않았습니다:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // 이미지 값을 고르는 manifestImageRefs 는 covers·cuts 만 본다 — generated 아래 추가 키는
  // 읽는 쪽에 영향이 없다. smartman 요청(#240)으로 세션·프로젝트 id·subject_tags 를 남긴다.
  const manifest = {
    version: MANIFEST_VERSION,
    subject: loaded.subject,
    cover_pick: COVER_PICK,
    covers: COVER_FILES.map((f) => `/demo-cache/${f}`),
    cuts: Object.fromEntries(Object.entries(CUT_FILES).map(([k, f]) => [k, `/demo-cache/${f}`])),
    generated: {
      date: kstDate(),
      // 값만 읽는다(키는 읽지 않음). 비어 있으면 기본 설정 openai.
      image_provider: process.env.IMAGE_PROVIDER?.trim() || "openai",
      commit: gitCommit(),
      session_id: args.session,
      project_id: loaded.projectId,
      subject_tags: loaded.subjectTags,
    },
  };

  mkdirSync(outDir, { recursive: true });
  for (const [file, buf] of files) writeFileSync(path.join(outDir, file), buf);
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`완료${args.dry ? "(--dry)" : ""}: ${outDir}`);
  console.log("--- PR 본문용 요약 ---");
  console.log(`- 세션: ${args.session} / 프로젝트: ${loaded.projectId}`);
  console.log(`- subject_tags: ${JSON.stringify(loaded.subjectTags)}`);
  console.log(`- cover_pick: ${COVER_PICK}(기준 컷 = 저장본 컷 1), image_provider: ${manifest.generated.image_provider}, commit: ${manifest.generated.commit}`);
  for (const [file, buf] of files) console.log(`- ${file}: ${(buf.length / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(`중단: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
