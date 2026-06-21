export function aggregateReviews(validReviews, anonymousResponses, criteria) {
  const weights = Object.fromEntries(criteria.map((item) => [item.id, item.weight]));
  const result = anonymousResponses.map((response) => {
    const criterionTotals = Object.fromEntries(criteria.map((item) => [item.id, { total: 0, count: 0 }]));
    for (const review of validReviews) {
      const entry = review.responses.find((item) => item.responseId === response.anonymousId);
      if (!entry) continue;
      for (const criterion of criteria) {
        criterionTotals[criterion.id].total += entry.scores[criterion.id];
        criterionTotals[criterion.id].count += 1;
      }
    }
    const averages = {};
    let weightedTotal = 0;
    let weightTotal = 0;
    let votes = 0;
    for (const criterion of criteria) {
      const bucket = criterionTotals[criterion.id];
      const average = bucket.count ? bucket.total / bucket.count : 0;
      averages[criterion.id] = Number(average.toFixed(2));
      weightedTotal += average * weights[criterion.id];
      weightTotal += weights[criterion.id];
      votes = Math.max(votes, bucket.count);
    }
    return {
      responseId: response.anonymousId,
      model: response.model,
      averages,
      weightedScore: Number((weightTotal ? weightedTotal / weightTotal : 0).toFixed(2)),
      validVotes: votes
    };
  });
  result.sort((a, b) => b.weightedScore - a.weightedScore || a.responseId.localeCompare(b.responseId));
  return result.map((item, index) => ({ ...item, rank: index + 1 }));
}
