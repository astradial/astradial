// Cloud archival must be opt-in with NO default bucket.
//
// Before this was parameterised, every self-hosted install shipped
// `misssellerai.firebasestorage.app` hardcoded in five places, so a stranger's
// `git clone` archived their customers' call recordings into someone else's
// bucket — and billed that bucket's owner for the storage and egress. That is a
// data-custody problem before it is a cost one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const files = [
  'src/server.js',
  'scripts/stitch-recordings.js',
  'scripts/move-recordings.sh',
];

test('no bucket name is hardcoded anywhere in the archival path', () => {
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const hits = src.match(/[a-z0-9-]+\.(firebasestorage\.app|appspot\.com)/gi) || [];
    assert.deepEqual(hits, [], `${f} hardcodes a bucket: ${hits.join(', ')}`);
  }
});

test('GCS_BUCKET has no fallback value', () => {
  for (const f of ['src/server.js', 'scripts/stitch-recordings.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const bad = src.match(/process\.env\.GCS_BUCKET\s*\|\|\s*['"][^'"]+['"]/g) || [];
    assert.deepEqual(bad, [], `${f} falls back to a literal bucket: ${bad.join(', ')}`);
  }
});

test('the sweeper refuses to run without a bucket rather than guessing', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'scripts/move-recordings.sh'), 'utf8');
  assert.match(sh, /if \[ -z "\$BUCKET" \]/, 'must guard on an empty bucket');
  assert.match(sh, /exit 0/, 'must exit cleanly, leaving recordings on local disk');
});
