import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSpeechResultTranscript,
  formatSpeechErrorMessage,
  getSpeechRecognitionConstructor,
  mergeTranscriptWithNotes,
} from './speechNotes';

test('getSpeechRecognitionConstructor resolves standard, webkit, or null cleanly', () => {
  class StandardSpeech {}
  class WebkitSpeech {}

  assert.equal(getSpeechRecognitionConstructor({ SpeechRecognition: StandardSpeech }), StandardSpeech);
  assert.equal(
    getSpeechRecognitionConstructor({ webkitSpeechRecognition: WebkitSpeech }),
    WebkitSpeech
  );
  assert.equal(getSpeechRecognitionConstructor({}), null);
  assert.equal(getSpeechRecognitionConstructor(undefined), null);
});

test('extractSpeechResultTranscript separates final and interim phrases from resultIndex', () => {
  const results = [
    { isFinal: true, 0: { transcript: 'Old phrase ignored' } },
    { isFinal: true, 0: { transcript: 'Floor 4 adhesive unloaded' } },
    { isFinal: false, 0: { transcript: 'near lift lobby' } },
  ];

  const extracted = extractSpeechResultTranscript(results, 1);
  assert.equal(extracted.finalTranscript, 'Floor 4 adhesive unloaded');
  assert.equal(extracted.interimTranscript, 'near lift lobby');
});

test('mergeTranscriptWithNotes appends spoken phrases with spacing and respects maxLength', () => {
  assert.equal(mergeTranscriptWithNotes('', '  Corridor tiling started  '), 'Corridor tiling started');
  assert.equal(
    mergeTranscriptWithNotes('Tower A:', '20 boxes shifted.'),
    'Tower A: 20 boxes shifted.'
  );
  assert.equal(
    mergeTranscriptWithNotes('Line 1\n', 'Line 2'),
    'Line 1\nLine 2'
  );

  const longExisting = 'a'.repeat(595);
  assert.equal(mergeTranscriptWithNotes(longExisting, 'extra words here', 600).length, 600);
});

test('formatSpeechErrorMessage returns actionable guidance and ignores aborted', () => {
  assert.match(formatSpeechErrorMessage('not-allowed'), /Microphone permission/i);
  assert.match(formatSpeechErrorMessage('audio-capture'), /No microphone/i);
  assert.match(formatSpeechErrorMessage('no-speech'), /No speech detected/i);
  assert.equal(formatSpeechErrorMessage('aborted'), '');
});
