// #307 대응 demo — 데모 캐시 모드의 순수 함수(demoCoverVariants·generateDemoCuts)와 실제 manifest 확인.
// 외부 호출·DB 접근 없음(public/demo-cache/manifest.json만 읽는다).
//
// 실행: npx tsx "app/(studio)/session/[id]/demo-cache-client.demo.ts"

import { readFileSync } from "node:fs";
import path from "node:path";
import type { DemoManifest } from "../../demo-mode";
import { demoCoverVariants, generateDemoCuts } from "./generate-client";
import type { Storyboard } from "./storyboard-types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(actual)}`}`);
}

const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "public", "demo-cache", "manifest.json"), "utf8")
) as DemoManifest;

// 1. 표지: manifest의 covers가 그대로 asset·image가 되고 requested는 장수
const covers = demoCoverVariants(manifest);
check("표지 장수", covers.variants.length, manifest.covers.length);
check("표지 requested", covers.requested, manifest.covers.length);
check("표지 asset=image=manifest 경로", covers.variants.map((v) => [v.asset, v.image]), manifest.covers.map((c) => [c, c]));
check("표지에 continuationToken 없음", covers.variants.some((v) => v.continuationToken !== undefined), false);

// 2. 컷: 1번(표지) 컷은 건드리지 않고 2~4번만 manifest에서 채운다
const board = {
  cuts: [1, 2, 3, 4].map((n) => ({ cut_index: n, generated_image: n === 1 ? manifest.covers[manifest.cover_pick - 1] : null })),
} as unknown as Storyboard;
const progress: Array<[number, number]> = [];
const onCutIdx: number[] = [];
const cuts = generateDemoCuts(board, manifest, {
  onProgress: (d, t) => progress.push([d, t]),
  onCut: (i) => onCutIdx.push(i),
});
check("컷 2~4 asset", cuts.map((c) => c.asset), ["2", "3", "4"].map((k) => manifest.cuts[k]));
check("onCut 배열 인덱스", onCutIdx, [1, 2, 3]);
check("진행 표시 0/3→3/3", progress, [[0, 3], [1, 3], [2, 3], [3, 3]]);

// 3. 이미 채워진 컷은 건너뛴다(이어서 만들기)
const half = {
  cuts: board.cuts.map((c, i) => (i === 1 ? { ...c, generated_image: "/demo-cache/cut-2.png" } : c)),
} as unknown as Storyboard;
check("이미 있는 컷 건너뜀", generateDemoCuts(half, manifest).map((c) => c.asset), ["3", "4"].map((k) => manifest.cuts[k]));

// 4. manifest에 없는 컷은 던진다
const missing: DemoManifest = { ...manifest, cuts: { "2": manifest.cuts["2"] } };
let threw = false;
try {
  generateDemoCuts(board, missing);
} catch {
  threw = true;
}
check("manifest에 없는 컷은 throw", threw, true);

if (failed > 0) {
  console.log(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log("\n전부 통과");
