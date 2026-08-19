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

if (hasError) {
  console.error("\nvocabulary.json이 바뀐 뒤 storyboard.schema.json의 enum을 안 맞춰준 것으로 보임.");
  process.exit(1);
} else {
  console.log("\n모든 값 목록이 vocabulary.json과 일치합니다.");
}
