// 지도사(preset.assets.character_sheet)가 컷마다 마주해서 대화하는 상대역 후보 풀 로더.
// preset.schema.json(이미 병합된 계약)은 안 건드리고, spec/data/counterpart_characters.json을
// 새로 추가해 해결함 — cta-presets.ts와 같은 패턴.

import counterpartsRaw from "@/spec/data/counterpart_characters.json";

const ASSET_URI_PATTERN = /^asset:\/\//;

export interface CounterpartCharacter {
  id: string;
  asset: string;
  description: string;
}

export interface CounterpartCharactersFile {
  counterpart_characters_version: string;
  selection: string;
  characters: CounterpartCharacter[];
}

export class CounterpartCharactersValidationError extends Error {}

export function assertValidCounterpartCharactersFile(
  data: unknown
): asserts data is CounterpartCharactersFile {
  if (typeof data !== "object" || data === null) {
    throw new CounterpartCharactersValidationError(
      "counterpart_characters.json이 객체가 아님"
    );
  }
  const d = data as Record<string, unknown>;

  if (typeof d.counterpart_characters_version !== "string") {
    throw new CounterpartCharactersValidationError(
      "counterpart_characters_version 누락/타입 오류"
    );
  }
  if (!Array.isArray(d.characters) || d.characters.length === 0) {
    throw new CounterpartCharactersValidationError("characters가 빈 배열이거나 없음");
  }

  const seenIds = new Set<string>();
  d.characters.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new CounterpartCharactersValidationError(`characters[${index}]가 객체가 아님`);
    }
    const c = raw as Record<string, unknown>;

    if (typeof c.id !== "string" || c.id.length === 0) {
      throw new CounterpartCharactersValidationError(`characters[${index}].id 누락`);
    }
    if (seenIds.has(c.id)) {
      throw new CounterpartCharactersValidationError(
        `characters[${index}].id 중복: "${c.id}"`
      );
    }
    seenIds.add(c.id);

    if (typeof c.asset !== "string" || !ASSET_URI_PATTERN.test(c.asset)) {
      throw new CounterpartCharactersValidationError(
        `characters[${index}].asset은 asset://로 시작해야 함 (id: ${c.id})`
      );
    }
    if (typeof c.description !== "string" || c.description.length === 0) {
      throw new CounterpartCharactersValidationError(
        `characters[${index}].description 누락 (id: ${c.id})`
      );
    }
  });
}

let cache: CounterpartCharactersFile | null = null;

export function loadCounterpartCharacters(): CounterpartCharactersFile {
  if (cache) return cache;
  assertValidCounterpartCharactersFile(counterpartsRaw);
  cache = counterpartsRaw;
  return cache;
}

/** 컷마다(또는 세션마다) 상대역 하나를 무작위로 고른다. */
export function pickRandomCounterpartCharacter(): CounterpartCharacter {
  const { characters } = loadCounterpartCharacters();
  const index = Math.floor(Math.random() * characters.length);
  return characters[index];
}

export function getCounterpartCharacterById(id: string): CounterpartCharacter | undefined {
  return loadCounterpartCharacters().characters.find((c) => c.id === id);
}
