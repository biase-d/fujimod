import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { publication, shareUrl } from './share.ts';

await test('publication detects local MIME and uses a content-addressed, encoded share URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'share-test-'));
  try {
    const path = join(dir, 'hello #?.txt');
    await writeFile(path, 'hello world\n');
    const plan = await publication(path);
    assert.equal(plan.contentType, 'text/plain');
    const digest = createHash('sha256').update('hello world\n').digest('hex');
    assert.equal(plan.key, `files/${digest}/hello #?.txt`);
    assert.equal(plan.url, `https://share.fujimod.com/file/files/${digest}/hello%20%23%3F.txt`);
    await assert.rejects(publication(path, { direct: true }), /requires an image or video/);
    await assert.rejects(publication(path, { contentType: 'invalid' }));
    const video = await publication(path, {
      contentType: 'video/ogg; codecs="theora"',
      key: 'clips/demo.ogv',
      direct: true,
    });
    assert.equal(video.video, true);
    assert.equal(video.contentType, 'video/ogg; codecs="theora"');
    assert.equal(video.url, 'https://share.fujimod.com/file/clips/demo.ogv?direct=true');
    await assert.rejects(publication(dir), /regular file/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

await test('R2 keys cannot escape the file route', () => {
  for (const key of ['', '/absolute', '../secret', 'a/../secret', 'a//b', 'a\nb', 'a\\b'])
    assert.throws(() => shareUrl(key));
  assert.equal(shareUrl('a/%2e%2e/file'), 'https://share.fujimod.com/file/a/%252e%252e/file');
});
