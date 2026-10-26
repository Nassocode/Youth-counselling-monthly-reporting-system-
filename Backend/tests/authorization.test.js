const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRole } = require('../src/middleware/auth');

function invoke(middleware, user) {
  const req = { user };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('role middleware allows a specifically authorized role', () => {
  const result = invoke(requireRole('vice_chairperson'), { role: 'vice_chairperson' });
  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, 200);
});

test('role middleware rejects other roles, including administrators', () => {
  for (const role of ['admin', 'chairperson', 'department_head', 'member']) {
    const result = invoke(requireRole('vice_chairperson'), { role });
    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 403);
    assert.deepEqual(result.res.payload, { error: 'forbidden' });
  }
});

test('role middleware rejects requests without an authenticated user', () => {
  const result = invoke(requireRole('admin'), undefined);
  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 403);
});
