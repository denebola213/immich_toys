import fs from 'fs';
import xxhash from 'xxhash-wasm';

export async function hashFile(filePath: string, api: Awaited<ReturnType<typeof xxhash>>): Promise<string> {
  const hasher = api.create64(0n);

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      hasher.update(chunk as Buffer);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  return hasher.digest().toString(16).padStart(16, '0');
}
