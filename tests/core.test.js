import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymizeResponses } from '../server/anonymize.js';
import { aggregateReviews } from '../server/aggregate.js';
import { extractJsonObject, validateReviewPayload } from '../server/reviewSchema.js';

const criteria = [
  { id: 'correctness', label: 'Korrektheit', weight: 2 },
  { id: 'depth', label: 'Tiefe', weight: 1 },
  { id: 'usefulness', label: 'Praxisnutzen', weight: 1 }
];

test('anonymization is deterministic for a seed and hides model order', () => {
  const responses = [{ model: 'a' }, { model: 'b' }, { model: 'c' }];
  const first = anonymizeResponses(responses, 'seed-1');
  const second = anonymizeResponses(responses, 'seed-1');
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => item.anonymousId), ['Response A', 'Response B', 'Response C']);
});

test('review JSON is extracted and strictly validated', () => {
  const payload = extractJsonObject('```json\n{"responses":[{"responseId":"Response A","scores":{"correctness":8,"depth":7,"usefulness":9},"rationale":"ok","strengths":["klar"],"weaknesses":["kurz"]}],"ranking":["Response A"]}\n```');
  const valid = validateReviewPayload(payload, ['Response A'], criteria.map((item) => item.id));
  assert.equal(valid.ok, true);
  const invalid = validateReviewPayload({ responses: [], ranking: [] }, ['Response A'], criteria.map((item) => item.id));
  assert.equal(invalid.ok, false);
});

test('review validation rejects duplicate responses and extra scores', () => {
  const ids = ['Response A', 'Response B'];
  const criteriaIds = criteria.map((item) => item.id);
  const duplicate = validateReviewPayload({
    responses: [
      { responseId: 'Response A', scores: { correctness: 8, depth: 8, usefulness: 8 }, rationale: 'ok', strengths: ['s'], weaknesses: ['w'] },
      { responseId: 'Response A', scores: { correctness: 7, depth: 7, usefulness: 7 }, rationale: 'ok', strengths: ['s'], weaknesses: ['w'] }
    ],
    ranking: ids
  }, ids, criteriaIds);
  assert.equal(duplicate.ok, false);

  const extraScore = validateReviewPayload({
    responses: [
      { responseId: 'Response A', scores: { correctness: 8, depth: 8, usefulness: 8, style: 10 }, rationale: 'ok', strengths: ['s'], weaknesses: ['w'] },
      { responseId: 'Response B', scores: { correctness: 7, depth: 7, usefulness: 7 }, rationale: 'ok', strengths: ['s'], weaknesses: ['w'] }
    ],
    ranking: ids
  }, ids, criteriaIds);
  assert.equal(extraScore.ok, false);
});

test('aggregation returns transparent weighted ranking', () => {
  const ranking = aggregateReviews([
    { responses: [
      { responseId: 'Response A', scores: { correctness: 10, depth: 6, usefulness: 6 } },
      { responseId: 'Response B', scores: { correctness: 6, depth: 10, usefulness: 10 } }
    ] },
    { responses: [
      { responseId: 'Response A', scores: { correctness: 8, depth: 8, usefulness: 8 } },
      { responseId: 'Response B', scores: { correctness: 7, depth: 7, usefulness: 7 } }
    ] }
  ], [{ anonymousId: 'Response A', model: 'a' }, { anonymousId: 'Response B', model: 'b' }], criteria);
  assert.equal(ranking[0].responseId, 'Response A');
  assert.equal(ranking[0].validVotes, 2);
  assert.equal(ranking[0].averages.correctness, 9);
});
