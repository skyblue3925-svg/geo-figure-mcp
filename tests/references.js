import assert from 'node:assert/strict';
import { referenceStore, createReferences } from '../src/references.js';

let now = 123;
const refs = referenceStore(2, 24, () => now);
const first = refs.put('a');
assert.match(first, /^[a-f0-9]{48}$/);
const second = refs.put('b');
const third = refs.put('c');
assert.equal(refs.get(first), undefined);
assert.equal(refs.get(second), 'b');
assert.equal(refs.get(third), 'c');
now += 30 * 60 * 1000;
assert.equal(refs.get(second), undefined);
assert.equal(refs.get(third), undefined);
const isolated = createReferences(true);
const id = isolated.previews.put('preview');
assert.equal(isolated.datasets.get(id), undefined);
assert.equal(createReferences(true).previews.get(id), undefined);
