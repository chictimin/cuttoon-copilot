// 데모 캐시(public/demo-cache/) 읽기(#240)가 manifest에 적힌 값만 읽는지, 그 밖의 값·경로 조작·
// manifest 없음에서 던지지 않고 null로 끝나는지, Export가 캐시 컷을 ZIP에 넣는지 확인한다.
// 임시 폴더에 가짜 public/을 만들어 쓴다 — 저장소의 public/과 버킷은 건드리지 않는다.
//
// 실행: npx tsx lib/render/demo-cache.demo.ts

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { isDemoCacheRef, manifestImageRefs, readDemoCacheImage } from "./demo-cache";
import { exportCuts } from "./export";
import type { Cut } from "./types";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function png(r: number): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 200, b: 200 } } })
    .png()
    .toBuffer();
}

const MANIFEST = {
  version: 1,
  subject: "데모 소재",
  cover_pick: 1,
  covers: ["/demo-cache/cover-1.png", "/demo-cache/cover-2.png", "/demo-cache/cover-3.png"],
  cuts: { "2": "/demo-cache/cut-2.png", "3": "/demo-cache/cut-3.png", "4": "/demo-cache/cut-4.png" },
};

function cut(index: number, image: string | null): Cut {
  return { cut_index: index, caption: { text: `${index}번 컷 대사`, bubble_type: "rounded", position: "top_left" }, generated_image: image };
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "demo-cache-"));
  const pub = path.join(root, "public");
  const dir = path.join(pub, "demo-cache");
  await mkdir(dir, { recursive: true });
  const images: Record<string, Buffer> = {};
  for (const [i, name] of ["cover-1", "cover-2", "cover-3", "cut-2", "cut-3", "cut-4", "extra"].entries()) {
    images[name] = await png(20 * i);
    await writeFile(path.join(dir, `${name}.png`), images[name]);
  }
  await writeFile(path.join(pub, "secret.png"), await png(255));

  try {
    // 판별
    check("public 경로는 캐시 값", isDemoCacheRef("/demo-cache/cover-1.png"));
    check("asset://는 캐시 값 아님", !isDemoCacheRef("asset://abc"));

    // manifest 목록 뽑기 — 모양이 어긋난 값은 manifest에 적혀 있어도 빼낸다
    const refs = manifestImageRefs({
      covers: ["/demo-cache/cover-1.png", "/demo-cache/../secret.png", "/demo-cache/sub/x.png", "../x.png", 123],
      cuts: { "2": "/demo-cache/cut-2.png", "3": "/demo-cache/a.gif", "4": null },
    });
    check(
      "manifest: covers·cuts 정상 값만 남김",
      refs.size === 2 && refs.has("/demo-cache/cover-1.png") && refs.has("/demo-cache/cut-2.png"),
      [...refs].join(", ")
    );
    check("manifest: 객체가 아니면 빈 목록", manifestImageRefs(null).size === 0 && manifestImageRefs("x").size === 0);
    check("manifest: cuts가 배열이면 무시", manifestImageRefs({ cuts: ["/demo-cache/cut-2.png"] }).size === 0);

    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(MANIFEST));

    // 읽기
    const cover = await readDemoCacheImage("/demo-cache/cover-1.png", pub);
    check("목록에 있는 표지를 읽음", cover !== null && cover.equals(images["cover-1"]));
    const c4 = await readDemoCacheImage("/demo-cache/cut-4.png", pub);
    check("목록에 있는 컷을 읽음", c4 !== null && c4.equals(images["cut-4"]));
    check("같은 폴더라도 목록에 없으면 null", (await readDemoCacheImage("/demo-cache/extra.png", pub)) === null);
    check("경로 조작 값은 null", (await readDemoCacheImage("/demo-cache/../secret.png", pub)) === null);
    check("대소문자가 다르면 null(정확 일치)", (await readDemoCacheImage("/demo-cache/Cover-1.png", pub)) === null);

    // manifest가 경로 조작 값을 적어도 폴더 밖은 읽지 않는다
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ ...MANIFEST, covers: ["/demo-cache/../secret.png"] }));
    check("manifest에 적힌 경로 조작 값도 null", (await readDemoCacheImage("/demo-cache/../secret.png", pub)) === null);

    // 목록에는 있는데 파일이 없음
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ ...MANIFEST, covers: ["/demo-cache/missing.png"] }));
    check("목록에 있지만 파일 없음 → null", (await readDemoCacheImage("/demo-cache/missing.png", pub)) === null);

    // manifest 깨짐·없음
    await writeFile(path.join(dir, "manifest.json"), "{ 깨진 json");
    check("manifest가 깨졌으면 null", (await readDemoCacheImage("/demo-cache/cover-1.png", pub)) === null);
    await rm(path.join(dir, "manifest.json"));
    check("manifest가 없으면 null", (await readDemoCacheImage("/demo-cache/cover-1.png", pub)) === null);

    // Export — 캐시 컷 4장이 모두 ZIP에 들어가는지(리허설 판정 "PNG 4장, X-Export-Skipped 없음")
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(MANIFEST));
    const all = await exportCuts(
      [cut(1, "/demo-cache/cover-1.png"), cut(2, "/demo-cache/cut-2.png"), cut(3, "/demo-cache/cut-3.png"), cut(4, "/demo-cache/cut-4.png")],
      { demoCachePublicDir: pub }
    );
    check(
      "Export: 캐시 4컷 모두 포함·건너뜀 없음",
      all.included.join(",") === "1,2,3,4" && all.skipped.length === 0 && all.zip.byteLength > 0,
      `included=${all.included} skipped=${all.skipped}`
    );

    const mixed = await exportCuts(
      [cut(1, "/demo-cache/cover-1.png"), cut(2, "/demo-cache/extra.png"), cut(3, null), cut(4, "/demo-cache/cut-4.png")],
      { demoCachePublicDir: pub }
    );
    check(
      "Export: 목록 밖 값·빈 이미지는 건너뜀으로 남김",
      mixed.included.join(",") === "1,4" && mixed.skipped.join(",") === "2,3",
      `included=${mixed.included} skipped=${mixed.skipped}`
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  if (failed > 0) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log(`\n${passed}건 통과`);
}

main();
