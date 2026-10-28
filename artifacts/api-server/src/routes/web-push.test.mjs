import test, { before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const previousVapidEnv = {
  publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
  privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
  subject: process.env.WEB_PUSH_VAPID_SUBJECT,
};
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'test-only-public-key';
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'test-only-private-key';
process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:test@example.invalid';

const columns = Object.fromEntries(
  ['id', 'endpoint', 'p256dh', 'auth', 'expirationTime', 'credentialHash', 'lastTestAt', 'createdAt', 'updatedAt']
    .map((name) => [name, { key: name }]),
);
const webPushTestSubscriptionsTable = columns;
const pushTokensTable = { token: { key: 'token' }, userId: { key: 'userId' }, platform: { key: 'platform' } };
const participantsTable = { id: { key: 'id' }, userId: { key: 'userId' }, experienceId: { key: 'experienceId' } };
const state = { rows: [], bindings: [], members: [], sends: [], providerError: null };
function rowsFor(table) { return table === pushTokensTable ? state.bindings : table === participantsTable ? state.members : state.rows; }

function matches(row, condition) {
  if (!condition) return true;
  if (condition.op === 'and') return condition.conditions.every((item) => matches(row, item));
  if (condition.op === 'or') return condition.conditions.some((item) => matches(row, item));
  const actual = row[condition.column.key];
  if (condition.op === 'eq') return actual === condition.value;
  if (condition.op === 'isNull') return actual == null;
  if (condition.op === 'lte') return actual <= condition.value;
  throw new Error(`Unsupported test predicate: ${condition.op}`);
}

const db = {
  transaction: async (run) => run(db),
  select() {
    return { from: (table) => ({ where: (condition) => ({ limit: async (limit) => rowsFor(table).filter((row) => matches(row, condition)).slice(0, limit) }) }) };
  },
  insert(table) {
    return { values: (row) => ({
      then: (resolve, reject) => Promise.resolve().then(() => { rowsFor(table).push({ ...row }); }).then(resolve, reject),
      onConflictDoUpdate: async ({ set }) => {
        const existing = rowsFor(table).find((item) => item.token === row.token);
        if (existing) Object.assign(existing, set); else rowsFor(table).push({ ...row });
      },
    }) };
  },
  update(table) {
    return { set: (values) => ({ where: (condition) => {
      const apply = () => { const selected = rowsFor(table).filter((row) => matches(row, condition)); for (const row of selected) Object.assign(row, values); return selected; };
      return { returning: async () => apply(), then: (resolve, reject) => Promise.resolve().then(apply).then(resolve, reject) };
    } }) };
  },
  delete(table) {
    return { where: async (condition) => {
      const rows = rowsFor(table);
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], condition)) rows.splice(i, 1);
    } };
  },
};

mock.module('@workspace/db', { exports: { db, webPushTestSubscriptionsTable, pushTokensTable, participantsTable } });
mock.module('drizzle-orm', { exports: {
  eq: (column, value) => ({ op: 'eq', column, value }),
  isNull: (column) => ({ op: 'isNull', column }),
  lte: (column, value) => ({ op: 'lte', column, value }),
  and: (...conditions) => ({ op: 'and', conditions }),
  or: (...conditions) => ({ op: 'or', conditions }),
} });
mock.module('web-push', { exports: {
  setVapidDetails: () => undefined,
  sendNotification: async (subscription, payload, options) => {
    state.sends.push({ subscription, payload: JSON.parse(payload), options });
    if (state.providerError) throw state.providerError;
    return { statusCode: 201 };
  },
} });

const { default: webPushRouter } = await import('./web-push.ts');
after(() => {
  for (const [key, value] of Object.entries({
    WEB_PUSH_VAPID_PUBLIC_KEY: previousVapidEnv.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: previousVapidEnv.privateKey,
    WEB_PUSH_VAPID_SUBJECT: previousVapidEnv.subject,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  mock.restoreAll();
});

beforeEach(() => {
  state.rows = [];
  state.bindings = [];
  state.members = [];
  state.sends = [];
  state.providerError = null;
});

const subscription = {
  endpoint: 'https://web.push.apple.com/device/test-only',
  keys: { p256dh: 'p'.repeat(65), auth: 'a'.repeat(24) },
  expirationTime: null,
};

async function invoke(method, path, { body, headers = {} } = {}) {
  const layer = webPushRouter.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} exists`);
  const req = {
    body,
    header: (name) => headers[name.toLowerCase()],
  };
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
  await layer.route.stack[0].handle(req, res);
  return res;
}

async function register(value = subscription) {
  const response = await invoke('post', '/subscriptions', { body: value });
  return { response, body: response.body };
}

test('registration returns a one-time device capability, stores only its hash, then test sends to its stored subscription', async () => {
  const { response: registration, body } = await register();
  assert.equal(registration.statusCode, 201);
  assert.equal(typeof body.deviceCredential, 'string');
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].credentialHash, createHash('sha256').update(body.deviceCredential).digest('hex'));
  assert.equal(Object.hasOwn(state.rows[0], 'deviceCredential'), false);

  const testResponse = await invoke('post', '/subscriptions/test', {
    headers: { authorization: `Bearer ${body.deviceCredential}` },
  });
  assert.equal(testResponse.statusCode, 202);
  assert.equal(testResponse.body.accepted, true);
  assert.equal(testResponse.body.received, false);
  assert.equal(typeof testResponse.body.correlationId, 'string');
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0].subscription.endpoint, subscription.endpoint);
});

test('missing or invalid device capability never invokes the provider', async () => {
  const noCredential = await invoke('post', '/subscriptions/test');
  assert.equal(noCredential.statusCode, 401);
  const invalid = await invoke('post', '/subscriptions/test', {
    headers: { authorization: `Bearer ${'x'.repeat(43)}` },
  });
  assert.equal(invalid.statusCode, 401);
  assert.equal(state.sends.length, 0);
});

test('provider expiry removes the matching registration and returns a safe error', async () => {
  const { body } = await register();
  state.providerError = Object.assign(new Error('private provider detail'), { statusCode: 410 });
  const response = await invoke('post', '/subscriptions/test', {
    headers: { authorization: `Bearer ${body.deviceCredential}` },
  });
  assert.equal(response.statusCode, 410);
  assert.equal(response.body.error, 'SUBSCRIPTION_EXPIRED');
  assert.equal(typeof response.body.correlationId, 'string');
  assert.equal(state.rows.length, 0);
  assert.equal(JSON.stringify(response.body).includes('private provider detail'), false);
});

test('provider failure returns a generic response without exposing provider details', async () => {
  const { body } = await register();
  state.providerError = new Error('private provider detail');
  const response = await invoke('post', '/subscriptions/test', {
    headers: { authorization: `Bearer ${body.deviceCredential}` },
  });
  assert.equal(response.statusCode, 502);
  assert.match(JSON.stringify(response.body), /PUSH_PROVIDER_FAILED/);
  assert.equal(JSON.stringify(response.body).includes('private provider detail'), false);
});

test('device credential revokes only its registration', async () => {
  const first = await register();
  const firstCredential = first.body.deviceCredential;
  const second = await register({
    ...subscription,
    endpoint: 'https://web.push.apple.com/device/second',
  });
  assert.equal(state.rows.length, 2);

  const response = await invoke('delete', '/subscriptions', {
    headers: { authorization: `Bearer ${firstCredential}` },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].credentialHash, createHash('sha256').update(second.body.deviceCredential).digest('hex'));
});

test('reminder binding requires device ownership and session membership, and does not duplicate the device', async () => {
  const { body } = await register();
  const headers = { authorization: `Bearer ${body.deviceCredential}`, 'x-pic-sync-guest-id': 'member-a' };
  const input = { headers, body: { experienceId: 'session-a' } };
  assert.equal((await invoke('post', '/subscriptions/reminders', input)).statusCode, 403);
  state.members.push({ id: 'membership', userId: 'member-a', experienceId: 'session-a' });
  assert.equal((await invoke('post', '/subscriptions/reminders', { ...input, headers: { ...headers, authorization: `Bearer ${'z'.repeat(43)}` } })).statusCode, 401);
  assert.equal(state.bindings.length, 0);
  assert.equal((await invoke('post', '/subscriptions/reminders', input)).statusCode, 204);
  assert.equal((await invoke('post', '/subscriptions/reminders', input)).statusCode, 204);
  assert.equal(state.bindings.length, 1);
  assert.equal(state.bindings[0].userId, 'member-a');
  assert.equal(state.bindings[0].platform, 'web');
  assert.equal(state.bindings[0].token, `webpush:${state.rows[0].id}`);
  await invoke('delete', '/subscriptions', { headers });
  assert.equal(state.bindings.length, 0);
  assert.equal(state.rows.length, 0);
});

test('manual test cooldown prevents a second provider send', async () => {
  const { body } = await register();
  const input = { headers: { authorization: `Bearer ${body.deviceCredential}` } };
  assert.equal((await invoke('post', '/subscriptions/test', input)).statusCode, 202);
  assert.equal((await invoke('post', '/subscriptions/test', input)).statusCode, 429);
  assert.equal(state.sends.length, 1);
});
