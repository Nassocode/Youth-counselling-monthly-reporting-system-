const test = require('node:test');
const assert = require('node:assert/strict');
const { REPORT_TEXT_LIMITS, isCompleteReport } = require('../src/reports/validation');

function completeReport() {
  return {
    title: 'Monthly report',
    mainObjectives: 'Objectives',
    summary: 'Summary',
    activities: 'Activities',
    achievements: 'Achievements',
    challenges: 'Challenges',
    solutions: 'Solutions',
    referrals: 'Referrals',
    recommendations: 'Recommendations',
    nextMonthPlan: 'Plan',
    remarks: 'Remarks',
    beneficiariesReached: 12,
    sessionsHeld: 4,
    individualSessions: 2,
    groupSessions: 2,
    outreachActivities: 1
  };
}

test('complete report accepts non-empty text and non-negative integer counts', () => {
  assert.equal(isCompleteReport(completeReport()), true);
});

test('complete report rejects blank text and unsafe or negative counts', () => {
  const blank = completeReport();
  blank.summary = '   ';
  assert.equal(isCompleteReport(blank), false);

  const negative = completeReport();
  negative.sessionsHeld = -1;
  assert.equal(isCompleteReport(negative), false);

  const fractional = completeReport();
  fractional.beneficiariesReached = 1.5;
  assert.equal(isCompleteReport(fractional), false);
});

test('complete report enforces each report text limit', () => {
  const tooLong = completeReport();
  tooLong.activities = 'x'.repeat(REPORT_TEXT_LIMITS.activities + 1);
  assert.equal(isCompleteReport(tooLong), false);
});
