const REPORT_TEXT_LIMITS = {
  title: 200,
  mainObjectives: 10000,
  summary: 5000,
  activities: 10000,
  achievements: 10000,
  challenges: 10000,
  solutions: 10000,
  referrals: 5000,
  recommendations: 10000,
  nextMonthPlan: 10000,
  remarks: 10000
};

function isCompleteReport(report) {
  return ['title', 'mainObjectives', 'summary', 'activities', 'achievements', 'challenges']
    .every((field) => (
    typeof report[field] === 'string'
    && report[field].trim().length > 0
    && report[field].length <= REPORT_TEXT_LIMITS[field]
  )) && Object.entries(REPORT_TEXT_LIMITS).every(([field, maxLength]) => (
    typeof report[field] === 'string' && report[field].length <= maxLength
  )) && Number.isSafeInteger(report.beneficiariesReached)
    && report.beneficiariesReached >= 0
    && Number.isSafeInteger(report.sessionsHeld)
    && report.sessionsHeld >= 0
    && Number.isSafeInteger(report.individualSessions)
    && report.individualSessions >= 0
    && Number.isSafeInteger(report.groupSessions)
    && report.groupSessions >= 0
    && Number.isSafeInteger(report.outreachActivities)
    && report.outreachActivities >= 0;
}

module.exports = { REPORT_TEXT_LIMITS, isCompleteReport };
