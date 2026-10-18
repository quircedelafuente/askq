import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isYes, asksForYes, isNewConversation } from '../src/confirm.js';

test('short affirmations are a yes', () => {
  for (const t of ['yes', 'Yes!', 'ok, send it', 'sure', 'sí', 'vale, mándalo', 'send it', 'book it', 'dale']) assert.ok(isYes(t), t);
});

test('new requests, negations and long phrases are not', () => {
  for (const t of ['send an email to Ana', 'no', 'yes but change the time', 'wait', 'ok but not now please', 'what time is it?', 'sí pero cambia la hora'])
    assert.ok(!isYes(t), t);
});

test('a reply ending in a question asks for a yes', () => {
  assert.ok(asksForYes('I found a bus at 9:00. Should I book it?'));
  assert.ok(!asksForYes('Your bus leaves at 9:00.'));
});

test('new conversation phrases', () => {
  assert.ok(isNewConversation('New conversation'));
  assert.ok(isNewConversation('nueva conversación'));
  assert.ok(!isNewConversation('start a new conversation with Ana'));
});
