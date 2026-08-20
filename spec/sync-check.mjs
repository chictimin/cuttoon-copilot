#!/usr/bin/env node
/**
 * vocabulary.json은 "0-provisional" 버전으로 계속 바뀔 수 있는데, storyboard.schema.json은
 * 그 값 목록을 enum으로 그대로 복사해서 갖고 있다 (JSON Schema가 다른 파일의 배열을 enum으로
 * 직접 참조할 방법이 없어서). 이 스크립트는 두 파일이 갈라졌는지 CI/커밋 전에 잡아낸다.
 *
 * 사용: node spec/sync-check.mjs
 * package.json에 추가: "spec:sync-check": "node spec/sync-check.mjs"
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const vocabulary = JSON.parse(fs.readFileSync(path.join(SPEC_DIR, "vocabulary.json"), "utf8"));
const storyboard = JSON.parse(
  fs.readFileSync(path.join(SPEC_DIR, "storyboard.schema.json"), "utf8")
);

function getEnumAt(schema, pathParts) {
  let node = schema;
  for (const part of pathParts) {
    node = node?.[part];
  }
  return node?.enum ?? null;
}

// vocabulary.json 키 -> storyboard.schema.json 안에서 그 값이 enum으로 복사된 위치
const MAPPINGS = [
  { vocabKey: "shot_type", schemaPath: ["$defs", "cut", "properties", "shot_type"] },
  { vocabKey: "camera_angle", schemaPath: ["$defs", "cut", "properties", "camera_angle"] },
  { vocabKey: "time_of_day", schemaPath: ["$defs", "cut", "properties", "time_of_day"] },
  { vocabKey: "narrative_beat", schemaPath: ["$defs", "cut", "properties", "narrative_beat"] },
  { vocabKey: "reserved_zone", schemaPath: ["$defs", "cut", "properties", "reserved_zone"] },
  {
    vocabKey: "expression",
    schemaPath: [
      "$defs",
      "cut",
      "properties",
      "characters_in_frame",
      "items",
      "properties",
      "expression",
    ],
  },
  {
    vocabKey: "pose",
    schemaPath: [
      "$defs",
      "cut",
      "properties",
      "characters_in_frame",
      "items",
      "properties",
      "pose",
    ],
  },
  {
    vocabKey: "bubble_type",
    schemaPath: ["$defs", "cut", "properties", "caption", "properties", "bubble_type"],
  },
  {
    vocabKey: "position",
    schemaPath: ["$defs", "cut", "properties", "caption", "properties", "position"],
  },
];

let hasError = false;

for (const { vocabKey, schemaPath } of MAPPINGS) {
  const vocabValues = vocabulary[vocabKey];
  const schemaEnum = getEnumAt(storyboard, schemaPath);

  if (!Array.isArray(vocabValues)) {
    console.error(`FAIL vocabulary.json에 "${vocabKey}" 배열이 없음`);
    hasError = true;
    continue;
  }
  if (!Array.isArray(schemaEnum)) {
    console.error(`FAIL storyboard.schema.json의 ${schemaPath.join(".")}.enum을 못 찾음`);
    hasError = true;
    continue;
  }

  const a = new Set(vocabValues);
  const b = new Set(schemaEnum);
  const onlyInVocab = [...a].filter((v) => !b.has(v));
  const onlyInSchema = [...b].filter((v) => !a.has(v));

  if (onlyInVocab.length || onlyInSchema.length) {
    hasError = true;
    console.error(`FAIL ${vocabKey} 불일치 (경로: ${schemaPath.join(".")})`);
    if (onlyInVocab.length) console.error(`  vocabulary.json에만 있음: ${onlyInVocab.join(", ")}`);
    if (onlyInSchema.length)
      console.error(`  storyboard.schema.json에만 있음: ${onlyInSchema.join(", ")}`);
  } else {
    console.log(`OK   ${vocabKey}`);
  }
}

// ── prompt_hints 커버리지 ──────────────────────────────────────────────────
//
// issue #121: prompt_hints에 항목이 없으면 buildCutPrompt의 hint()가 enum 토큰을 그대로
// 흘려보내고 모델이 못 알아듣는다 (codex 4회 검증: "Shot type: closeup."이 4/4 전신으로
// 나왔고, 서술문으로 바꾼 뒤 4/4 통과). character_ratio는 그 상태로 4/4 무시됐다.
//
// 그 누락이 어떤 검사에도 안 걸리고 통과해 온 것이 원인이라 여기서 잡는다. 다만 모든 값
// 목록이 힌트를 요구하지는 않는다 — 요구하지 않는 것은 이유와 함께 아래에 적어 두고,
// 어느 쪽에도 분류되지 않은 값 목록이 생기면 그것도 실패로 잡는다. 새 enum을 추가하면서
// 힌트 필요 여부를 결정하지 않고 넘어가는 것을 막는 장치다.

const preset = JSON.parse(fs.readFileSync(path.join(SPEC_DIR, "preset.schema.json"), "utf8"));

// 값 목록이 vocabulary.json 최상위에 있는 것은 vocabKey만, preset.schema.json의 enum인
// 것은 schemaPath까지 적는다(#121 선택지 1번 — prompt_hints에 preset 필드 항목도 허용).
const HINT_REQUIRED = [
  { key: "expression" },
  { key: "pose" },
  { key: "shot_type" },
  { key: "camera_angle" },
  { key: "time_of_day" },
  { key: "narrative_beat" },
  {
    key: "character_ratio",
    schemaPath: ["properties", "style", "properties", "character_ratio"],
  },
  {
    key: "life_stage",
    schemaPath: ["properties", "context", "properties", "life_stage", "items"],
  },
];

const HINT_NOT_REQUIRED = {
  bubble_type: "말풍선은 생성 이미지에 넣지 않고 나중에 합성한다(B③) — 이미지 프롬프트에 안 들어감",
  position: "캡션 위치도 텍스트 레이어 합성용이라 이미지 프롬프트에 안 들어감",
  reserved_zone: "B①이 reservedZoneHint() 전용 서술문을 쓴다 — 프레임 안을 비우라는 지시라 일반 서술문과 성격이 다름",
};

const hints = vocabulary.prompt_hints ?? {};
let hintError = false;

for (const { key, schemaPath } of HINT_REQUIRED) {
  const values = schemaPath ? getEnumAt(preset, schemaPath) : vocabulary[key];
  const source = schemaPath ? `preset.schema.json ${schemaPath.join(".")}` : `vocabulary.json ${key}`;

  if (!Array.isArray(values)) {
    console.error(`FAIL ${source}에서 값 목록을 못 찾음`);
    hintError = true;
    continue;
  }

  const table = hints[key];
  if (!table || typeof table !== "object") {
    console.error(`FAIL prompt_hints에 "${key}" 항목이 없음 — enum 토큰이 프롬프트로 그대로 나간다`);
    hintError = true;
    continue;
  }

  const missing = values.filter((v) => typeof table[v] !== "string" || !table[v].trim());
  const extra = Object.keys(table).filter((v) => !values.includes(v));

  if (missing.length || extra.length) {
    hintError = true;
    console.error(`FAIL prompt_hints.${key} 불일치 (값 목록: ${source})`);
    if (missing.length) console.error(`  힌트 없음: ${missing.join(", ")}`);
    if (extra.length) console.error(`  값 목록에 없는 힌트: ${extra.join(", ")}`);
  } else {
    console.log(`OK   prompt_hints.${key} (${values.length}개)`);
  }
}

// 분류되지 않은 값 목록 탐지. _comment_ 로 시작하는 키는 설명용이라 카테고리가 아니다.
const classified = new Set([...HINT_REQUIRED.map((h) => h.key), ...Object.keys(HINT_NOT_REQUIRED)]);
const unclassified = Object.keys(vocabulary).filter(
  (k) => Array.isArray(vocabulary[k]) && !classified.has(k)
);
if (unclassified.length) {
  hintError = true;
  console.error(
    `FAIL 힌트 필요 여부가 정해지지 않은 값 목록: ${unclassified.join(", ")}\n` +
      `  이 스크립트의 HINT_REQUIRED 또는 HINT_NOT_REQUIRED에 이유와 함께 추가할 것.`
  );
}

const strayComments = Object.keys(hints).filter(
  (k) => !k.startsWith("_comment") && !classified.has(k)
);
if (strayComments.length) {
  hintError = true;
  console.error(`FAIL prompt_hints에 분류되지 않은 카테고리: ${strayComments.join(", ")}`);
}

if (hasError || hintError) {
  if (hasError) {
    console.error("\nvocabulary.json이 바뀐 뒤 storyboard.schema.json의 enum을 안 맞춰준 것으로 보임.");
  }
  if (hintError) {
    console.error("\nprompt_hints 누락은 enum 토큰을 프롬프트에 그대로 흘려보낸다(issue #121).");
  }
  process.exit(1);
} else {
  console.log("\n모든 값 목록이 vocabulary.json과 일치하고, prompt_hints 커버리지도 채워져 있습니다.");
}
