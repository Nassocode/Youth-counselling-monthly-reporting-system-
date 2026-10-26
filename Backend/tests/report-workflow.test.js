const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTransition } = require('../src/reports/workflow');

test('report workflow accepts the correct role at each approval stage', () => {
  assert.equal(validateTransition('submit', 'draft', 'member').ok, true);
  assert.equal(validateTransition('department_forward', 'submitted', 'department_head').ok, true);
  assert.equal(validateTransition('secretary_forward', 'secretary_review', 'secretary').ok, true);
  const viceForward = validateTransition('vice_forward', 'vice_review', 'vice_chairperson');
  assert.equal(viceForward.ok, true);
  assert.equal(viceForward.transition.decision, 'forwarded');
  assert.equal(validateTransition('chair_approve', 'chair_review', 'chairperson').ok, true);
});

test('report workflow rejects wrong roles and invalid status transitions', () => {
  assert.deepEqual(
    validateTransition('secretary_forward', 'secretary_review', 'department_head'),
    { ok: false, error: 'forbidden', status: 403 }
  );
  assert.deepEqual(
    validateTransition('chair_approve', 'vice_review', 'chairperson'),
    { ok: false, error: 'invalid_report_transition', status: 409 }
  );
});

test('return and reject decisions require a review comment', () => {
  assert.deepEqual(
    validateTransition('department_return', 'submitted', 'department_head'),
    { ok: false, error: 'review_comment_required', status: 400 }
  );
  assert.equal(validateTransition('department_return', 'submitted', 'department_head', 'Please revise').ok, true);
  assert.equal(validateTransition('vice_reject', 'vice_review', 'vice_chairperson', 'Not approved').ok, true);
});
