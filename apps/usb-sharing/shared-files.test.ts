import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './test-runtime.ts';

await test('R2 viewer serves native media, Open Graph, ranges and downloads', async () => {
  const mf = await runtime();
  try {
    const bucket = await mf.getR2Bucket('SHARED_FILES');
    const key = 'walkthroughs/hero.mp4';
    const bytes = new TextEncoder().encode('0123456789abcdefghij');
    const video = await bucket.put(key, bytes, { httpMetadata: { contentType: 'video/mp4' } });
    await bucket.put(`${key}.poster.png`, 'poster', { httpMetadata: { contentType: 'image/png' } });
    const page = await mf.dispatchFetch(`https://worker.example/file/${key}?type=video`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('Content-Security-Policy')!, /default-src 'none'/);
    const html = await page.text();
    assert.match(html, /<video controls playsinline/);
    assert.match(html, /property="og:type" content="video.other"/);
    assert.match(
      html,
      /property="og:video" content="https:\/\/share.fujimod.com\/media\/walkthroughs\/hero.mp4"/,
    );
    assert.match(
      html,
      /property="og:image" content="https:\/\/share.fujimod.com\/media\/walkthroughs\/hero.mp4.poster.png"/,
    );
    assert.ok(html.indexOf('<video') < html.indexOf('<table'));
    assert.ok(html.indexOf('</table>') < html.indexOf('>Download</a>'));
    assert.doesNotMatch(html, /<script|<header|<nav|<button/);
    assert.match(
      await (await mf.dispatchFetch('https://worker.example/file-viewer.css')).text(),
      /background: #000/,
    );
    const head = await mf.dispatchFetch(`https://worker.example/media/${key}`, { method: 'HEAD' });
    assert.equal(head.headers.get('Content-Length'), '20');
    assert.equal(await head.text(), '');
    const full = await mf.dispatchFetch(`https://worker.example/media/${key}`);
    assert.equal(full.headers.get('Content-Type'), 'video/mp4');
    assert.equal(full.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(new Uint8Array(await full.arrayBuffer()), bytes);
    for (const [range, text, contentRange] of [
      ['bytes=2-5', '2345', 'bytes 2-5/20'],
      ['bytes=17-', 'hij', 'bytes 17-19/20'],
      ['bytes=-3', 'hij', 'bytes 17-19/20'],
      ['bytes=18-99', 'ij', 'bytes 18-19/20'],
    ]) {
      const response = await mf.dispatchFetch(`https://worker.example/media/${key}`, {
        headers: { Range: range },
      });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('Content-Range'), contentRange);
      assert.equal(await response.text(), text);
    }
    for (const range of ['bytes=30-', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=3-2']) {
      const response = await mf.dispatchFetch(`https://worker.example/media/${key}`, {
        headers: { Range: range },
      });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get('Content-Range'), 'bytes */20');
    }
    assert.equal(
      (
        await mf.dispatchFetch(`https://worker.example/media/${key}`, {
          headers: { 'If-None-Match': video!.httpEtag },
        })
      ).status,
      304,
    );
    assert.equal(
      (
        await mf.dispatchFetch(`https://worker.example/media/${key}`, {
          headers: { Range: 'bytes=0-2', 'If-Range': '"other"' },
        })
      ).status,
      200,
    );
    const download = await mf.dispatchFetch(`https://worker.example/download/${key}`);
    assert.equal(download.headers.get('Content-Type'), 'application/octet-stream');
    assert.match(download.headers.get('Content-Disposition')!, /attachment;.*hero.mp4/);
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
    assert.doesNotMatch(
      await (await mf.dispatchFetch(`https://worker.example/file/${key}?type=download`)).text(),
      /<video|og:video/,
    );
    await bucket.put('image.png', 'image', { httpMetadata: { contentType: 'image/png' } });
    assert.match(
      await (await mf.dispatchFetch('https://worker.example/file/image.png')).text(),
      /og:image.*https:\/\/share.fujimod.com\/media\/image.png/,
    );
    assert.doesNotMatch(
      await (await mf.dispatchFetch('https://worker.example/file/image.png?type=video')).text(),
      /<img|<video/,
    );
  } finally {
    await mf.dispose();
  }
});

await test('hostile metadata is escaped; active documents and private reports have no public preview', async () => {
  const mf = await runtime();
  try {
    const bucket = await mf.getR2Bucket('SHARED_FILES');
    const key = '<img src=x onerror=alert(1)>.html';
    const path = encodeURIComponent(key);
    await bucket.put(key, '<script>alert(1)</script>', {
      httpMetadata: { contentType: 'text/html', contentDisposition: 'inline' },
      customMetadata: { caption: '"><svg onload=alert(1)>' },
    });
    const html = await (
      await mf.dispatchFetch(`https://worker.example/file/${path}?type=image`)
    ).text();
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;.html/);
    assert.match(html, /&quot;&gt;&lt;svg onload=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img|<video|<svg|<script|<iframe|<object|<embed/);
    assert.equal((await mf.dispatchFetch(`https://worker.example/media/${path}`)).status, 415);
    const download = await mf.dispatchFetch(`https://worker.example/download/${path}`);
    assert.equal(download.headers.get('Content-Type'), 'application/octet-stream');
    assert.match(download.headers.get('Content-Disposition')!, /^attachment;/);
    assert.match(download.headers.get('Content-Security-Policy')!, /sandbox/);
    await bucket.put('spoof.png', '<script>alert(1)</script>', {
      httpMetadata: { contentType: 'image/png' },
    });
    const spoof = await mf.dispatchFetch('https://worker.example/media/spoof.png');
    assert.equal(spoof.headers.get('Content-Type'), 'image/png');
    assert.equal(spoof.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(spoof.headers.get('Content-Security-Policy')!, /sandbox/);
    await bucket.put('image.svg', '<svg onload="alert(1)"></svg>', {
      httpMetadata: { contentType: 'image/svg+xml' },
    });
    const svg = await mf.dispatchFetch('https://worker.example/file/image.svg?direct=true');
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get('Content-Type'), 'image/svg+xml');
    assert.equal(svg.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
    assert.equal(
      (await mf.dispatchFetch(`https://worker.example/file/${path}?direct=true`)).status,
      415,
    );
    await (await mf.getR2Bucket('ISSUE_REPORTS')).put('secret/report.tar', 'private');
    for (const route of ['file', 'download'])
      assert.equal(
        (await mf.dispatchFetch(`https://worker.example/${route}/secret/report.tar`)).status,
        404,
      );
    for (const path of ['%ZZ', '%00'])
      assert.equal((await mf.dispatchFetch(`https://worker.example/file/${path}`)).status, 400);
    assert.equal((await mf.dispatchFetch('https://worker.example/file/missing')).status, 404);
    assert.equal(
      (await mf.dispatchFetch('https://worker.example/file/image.png', { method: 'POST' })).status,
      405,
    );
    assert.equal((await mf.dispatchFetch('https://worker.example/health')).status, 200);
  } finally {
    await mf.dispose();
  }
});

await test('direct media preserves uploaded MIME types, ranges and HEAD', async () => {
  const mf = await runtime();
  try {
    const bucket = await mf.getR2Bucket('SHARED_FILES');
    for (const type of ['video/ogg; codecs="theora"', 'image/bmp', 'IMAGE/TIFF']) {
      await bucket.put('file', '0123456789', { httpMetadata: { contentType: type } });
      const url = 'https://worker.example/file/file?direct=true';
      const response = await mf.dispatchFetch(url, { headers: { Range: 'bytes=2-5' } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('Content-Type'), type);
      assert.match(response.headers.get('Content-Security-Policy')!, /default-src 'none'/);
      if (type.toLowerCase().startsWith('video/'))
        assert.equal(
          response.headers.get('Content-Security-Policy'),
          "default-src 'none'; media-src 'self'",
        );
      assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
      assert.equal(await response.text(), '2345');
      const head = await mf.dispatchFetch(url, { method: 'HEAD' });
      assert.equal(head.headers.get('Content-Type'), type);
      assert.equal(head.headers.get('Content-Length'), '10');
      assert.equal(await head.text(), '');
    }
  } finally {
    await mf.dispose();
  }
});
