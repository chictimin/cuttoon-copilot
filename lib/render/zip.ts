// 컷 이미지들을 ZIP으로 묶는다. archiver v8은 factory 함수(archiver('zip'))가 아니라
// ZipArchive 클래스로 바뀌었다(예전 프로토타입에서 이미 겪은 breaking change).

import { ZipArchive } from "archiver";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export async function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  const archive = new ZipArchive();
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  for (const entry of entries) archive.append(entry.data, { name: entry.name });
  await archive.finalize();

  return done;
}
