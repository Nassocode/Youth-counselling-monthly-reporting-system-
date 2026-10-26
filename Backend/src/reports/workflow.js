const transitions = {
  submit: { role: 'member', from: ['draft', 'returned'], to: 'submitted', stage: null, decision: 'submitted' },
  department_forward: { role: 'department_head', from: ['submitted'], to: 'secretary_review', stage: 'department', decision: 'forwarded' },
  department_return: { role: 'department_head', from: ['submitted'], to: 'returned', stage: 'department', decision: 'returned', commentRequired: true },
  secretary_forward: { role: 'secretary', from: ['secretary_review'], to: 'vice_review', stage: 'secretary', decision: 'forwarded' },
  secretary_return: { role: 'secretary', from: ['secretary_review'], to: 'returned', stage: 'secretary', decision: 'returned', commentRequired: true },
  vice_forward: { role: 'vice_chairperson', from: ['vice_review'], to: 'chair_review', stage: 'vice', decision: 'forwarded' },
  vice_return: { role: 'vice_chairperson', from: ['vice_review'], to: 'returned', stage: 'vice', decision: 'returned', commentRequired: true },
  vice_reject: { role: 'vice_chairperson', from: ['vice_review'], to: 'rejected', stage: 'vice', decision: 'rejected', commentRequired: true },
  chair_approve: { role: 'chairperson', from: ['chair_review'], to: 'approved', stage: 'chair', decision: 'approved' },
  chair_return: { role: 'chairperson', from: ['chair_review'], to: 'returned', stage: 'chair', decision: 'returned', commentRequired: true },
  chair_reject: { role: 'chairperson', from: ['chair_review'], to: 'rejected', stage: 'chair', decision: 'rejected', commentRequired: true }
};

function validateTransition(action, currentStatus, role, comment = '') {
  const transition = transitions[action];
  if (!transition) return { ok: false, error: 'invalid_workflow_action', status: 400 };
  if (transition.role !== role) return { ok: false, error: 'forbidden', status: 403 };
  if (!transition.from.includes(currentStatus)) {
    return { ok: false, error: 'invalid_report_transition', status: 409 };
  }
  if (transition.commentRequired && !comment.trim()) {
    return { ok: false, error: 'review_comment_required', status: 400 };
  }
  return { ok: true, transition };
}

module.exports = { transitions, validateTransition };
