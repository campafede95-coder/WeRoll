import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// Exercise the real worker/routes against an in-memory relational adapter.
const names = {
  experiencesTable: ["id", "ownerId", "name", "sessionStatus", "createdAt"],
  memoriesTable: [
    "id",
    "experienceId",
    "authorId",
    "reminderId",
    "imageUri",
    "capturedAt",
  ],
  participantsTable: ["id", "experienceId", "userId"],
  pushTokensTable: ["id", "userId", "token", "platform"],
  reminderDeliveriesTable: [
    "id",
    "reminderId",
    "token",
    "status",
    "ticketId",
    "leaseUntil",
    "leaseOwner",
    "attempts",
    "updatedAt",
  ],
  remindersTable: ["id", "experienceId", "title", "scheduledAt", "notifiedAt"],
  usersTable: ["id", "displayName", "avatarUrl"],
  webPushTestSubscriptionsTable: [
    "id",
    "endpoint",
    "p256dh",
    "auth",
    "expirationTime",
    "credentialHash",
    "updatedAt",
  ],
};
const tables = Object.fromEntries(
  Object.entries(names).map(([table, keys]) => [
    table,
    Object.assign(
      { $table: table },
      Object.fromEntries(keys.map((key) => [key, { table, key }])),
    ),
  ]),
);
let rows, calls, storageFailure, pushFailure, beforeTransaction, vapidFailure;
const value = (col, row) => (col?.table ? row[col.table]?.[col.key] : col);
function matches(c, row) {
  if (!c) return true;
  const [a, b] = c.args;
  switch (c.op) {
    case "and":
      return c.args.every((x) => matches(x, row));
    case "or":
      return c.args.some((x) => matches(x, row));
    case "eq":
      return value(a, row) === value(b, row);
    case "isNull":
      return value(a, row) == null;
    case "inArray":
      return b.includes(value(a, row));
    case "lte":
      return value(a, row) <= b;
    case "gte":
      return value(a, row) >= b;
    default:
      throw new Error(c.op);
  }
}
function project(fields, row, table) {
  return fields
    ? Object.fromEntries(
        Object.entries(fields).map(([key, col]) => [
          key,
          col.$table ? row[col.$table] : value(col, row),
        ]),
      )
    : row[table];
}
let transactions = Promise.resolve();
const db = {
  execute: async () => {},
  transaction: (run) => {
    const result = transactions.then(() => {
      beforeTransaction?.();
      return run(db);
    });
    transactions = result.catch(() => {});
    return result;
  },
  select(fields) {
    let table,
      condition,
      limit = Infinity;
    const joins = [];
    const q = {
      from(t) {
        table = t.$table;
        return q;
      },
      innerJoin(t, c) {
        joins.push({ table: t.$table, c, left: false });
        return q;
      },
      leftJoin(t, c) {
        joins.push({ table: t.$table, c, left: true });
        return q;
      },
      where(c) {
        condition = c;
        return q;
      },
      limit(n) {
        limit = n;
        return q;
      },
      orderBy() {
        return q;
      },
      for() {
        return q;
      },
      then(ok, bad) {
        return Promise.resolve()
          .then(() => {
            let result = rows[table].map((row) => ({ [table]: row }));
            for (const j of joins)
              result = result.flatMap((row) => {
                const found = rows[j.table]
                  .map((item) => ({ ...row, [j.table]: item }))
                  .filter((x) => matches(j.c, x));
                return found.length
                  ? found
                  : j.left
                    ? [{ ...row, [j.table]: null }]
                    : [];
              });
            return result
              .filter((row) => matches(condition, row))
              .slice(0, limit)
              .map((row) => project(fields, row, table));
          })
          .then(ok, bad);
      },
    };
    return q;
  },
  insert(t) {
    return {
      values(input) {
        const add = (conflict) => {
          for (const row of Array.isArray(input) ? input : [input]) {
            if (conflict && rows[t.$table].some((x) => x.id === row.id))
              continue;
            rows[t.$table].push({
              status: "pending",
              attempts: 0,
              updatedAt: new Date(),
              notifiedAt: null,
              ...row,
            });
          }
        };
        return {
          then: (ok, bad) =>
            Promise.resolve()
              .then(() => add(false))
              .then(ok, bad),
          onConflictDoNothing: async () => add(true),
          onConflictDoUpdate: async ({ target, set }) => {
            const row = Array.isArray(input) ? input[0] : input;
            const existing = rows[t.$table].find(item => item[target.key] === row[target.key]);
            if (existing) Object.assign(existing, set);
            else add(false);
          },
        };
      },
    };
  },
  update(t) {
    return {
      set(values) {
        return {
          where(c) {
            const apply = (fields) =>
              rows[t.$table]
                .filter((row) => matches(c, { [t.$table]: row }))
                .map((row) => {
                  Object.assign(row, values);
                  return project(fields, { [t.$table]: row }, t.$table);
                });
            return {
              returning: async (fields) => apply(fields),
              then: (ok, bad) =>
                Promise.resolve()
                  .then(() => apply())
                  .then(ok, bad),
            };
          },
        };
      },
    };
  },
  delete(t) {
    return {
      where: async (c) => {
        rows[t.$table] = rows[t.$table].filter(
          (row) => !matches(c, { [t.$table]: row }),
        );
      },
    };
  },
};
mock.module("@workspace/db", { exports: { db, ...tables } });
const ops = Object.fromEntries(
  ["and", "or", "eq", "isNull", "inArray", "lte", "gte"].map((op) => [
    op,
    (...args) => ({ op, args }),
  ]),
);
mock.module("drizzle-orm", {
  exports: { ...ops, asc: (x) => x, desc: (x) => x, sql: () => ({}) },
});
mock.module("../lib/logger.ts", {
  exports: { logger: { info() {}, warn() {}, error() {} } },
});
mock.module("../lib/firebaseStorage.ts", {
  exports: {
    uploadFirebaseImage: async (input) => {
      calls.uploads.push(input);
      if (storageFailure) throw new Error("storage");
      return `gs://test/${input.objectPath}`;
    },
    deleteFirebaseObject: async () => {},
    createFirebaseImageUrl: (uri) =>
      uri && `https://images.invalid/${uri.slice(5)}`,
  },
});
mock.module("web-push", {
  exports: {
    setVapidDetails() {
      if (vapidFailure) throw new Error("invalid configuration");
    },
    sendNotification: async (subscription, payload) => {
      calls.web.push({ subscription, payload: JSON.parse(payload) });
      if (pushFailure) throw pushFailure;
      return { statusCode: 201 };
    },
  },
});
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "fixture";
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "fixture";
process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:test@example.invalid";
const { default: router, deliverDuePhotoReminders } =
  await import("./experiences.ts");
const { default: webPushRouter } = await import("./web-push.ts");
const { webRecipients, sendWebReminder, reminderPayload } =
  await import("../lib/webPushReminders.ts");
beforeEach(() => {
  rows = Object.fromEntries(Object.keys(names).map((name) => [name, []]));
  calls = { web: [], expo: [], receipts: [], uploads: [] };
  beforeTransaction = null;
  vapidFailure = false;
  storageFailure = false;
  pushFailure = null;
  rows.experiencesTable.push({
    id: "session-a",
    ownerId: "organizer",
    name: "Shared",
    sessionStatus: "active",
  });
  rows.usersTable.push(
    { id: "organizer", displayName: "Organizer" },
    { id: "member-a", displayName: "A" },
    { id: "member-b", displayName: "B" },
  );
  rows.participantsTable.push(
    { id: "p1", userId: "member-a", experienceId: "session-a" },
    { id: "p2", userId: "member-b", experienceId: "session-a" },
  );
  rows.remindersTable.push({
    id: "reminder-a",
    experienceId: "session-a",
    title: "Photo",
    scheduledAt: new Date(Date.now() - 1000),
    notifiedAt: null,
  });
  rows.webPushTestSubscriptionsTable.push({
    id: "web-a",
    endpoint: "https://web.push.apple.com/device/a",
    p256dh: "p",
    auth: "a",
    expirationTime: null,
    updatedAt: new Date(),
  });
  rows.pushTokensTable.push(
    {
      id: "binding",
      userId: "member-a",
      token: "webpush:web-a",
      platform: "web",
    },
    {
      id: "native",
      userId: "member-b",
      token: "ExponentPushToken[native]",
      platform: "android",
    },
  );
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("getReceipts")) {
      const { ids } = JSON.parse(options.body);
      calls.receipts.push(ids);
      return {
        ok: true,
        json: async () => ({
          data: Object.fromEntries(ids.map((id) => [id, { status: "ok" }])),
        }),
      };
    }
    calls.expo.push({ url, messages: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: JSON.parse(options.body).map(() => ({
          status: "ok",
          id: "ticket",
        })),
      }),
    };
  };
});
async function invoke(
  method,
  path,
  {
    user = "member-a",
    params = { experienceId: "session-a" },
    headers = {},
    body,
    targetRouter = router,
  } = {},
) {
  const route = targetRouter.stack.find(
    (x) => x.route?.path === path && x.route.methods[method],
  ).route;
  const req = {
    params,
    body,
    header: (name) =>
      name === "x-pic-sync-guest-id" ? user : headers[name.toLowerCase()],
  };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send() {
      return this;
    },
  };
  await route.stack.at(-1).handle(req, res);
  return res;
}
test("real worker routes devices to the correct providers once, using the shared ledger", async () => {
  await deliverDuePhotoReminders();
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 1);
  assert.equal(calls.expo.length, 1);
  assert.deepEqual(
    calls.expo[0].messages.map((x) => x.to),
    ["ExponentPushToken[native]"],
  );
  assert.equal(
    calls.web[0].subscription.endpoint,
    "https://web.push.apple.com/device/a",
  );
  assert.equal(calls.web[0].payload.experienceId, "session-a");
  assert.equal(calls.web[0].payload.reminderId, "reminder-a");
  assert.equal(
    rows.reminderDeliveriesTable.find((x) => x.token === "webpush:web-a")
      .status,
    "accepted",
  );
  assert.equal(
    rows.reminderDeliveriesTable.find((x) => x.token.startsWith("Exponent"))
      .status,
    "ticketed",
  );
});
test("web-only reminder is completed without any Expo request", async () => {
  rows.pushTokensTable = rows.pushTokensTable.filter(
    (x) => x.platform === "web",
  );
  await deliverDuePhotoReminders();
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 1);
  assert.equal(calls.expo.length, 0);
  assert.ok(rows.remindersTable[0].notifiedAt);
});
test("nonmembers, manual-only registrations, closed sessions and old reminders are excluded", async () => {
  rows.pushTokensTable = [];
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 0);
  rows.pushTokensTable = [
    { userId: "outsider", token: "webpush:web-a", platform: "web" },
  ];
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 0);
  rows.pushTokensTable[0].userId = "member-a";
  rows.experiencesTable[0].sessionStatus = "closed";
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 0);
  rows.experiencesTable[0].sessionStatus = "active";
  rows.remindersTable[0].scheduledAt = new Date(Date.now() - 16 * 60_000);
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 0);
});
test("transient failure retries only web; 410 removes only its registration and 404 is permanent too", async () => {
  pushFailure = { statusCode: 503 };
  await deliverDuePhotoReminders();
  assert.equal(
    rows.reminderDeliveriesTable.find((x) => x.token === "webpush:web-a")
      .status,
    "pending",
  );
  pushFailure = { statusCode: 410 };
  await deliverDuePhotoReminders();
  assert.equal(calls.expo.length, 1);
  assert.equal(rows.webPushTestSubscriptionsTable.length, 0);
  assert.equal(
    rows.pushTokensTable.some((x) => x.platform === "web"),
    false,
  );
  assert.equal(
    rows.pushTokensTable.some((x) => x.platform === "android"),
    true,
  );
  const payload = reminderPayload({
    experienceId: "s",
    reminderId: "r",
    scheduledAt: new Date(),
    title: "x",
    organizerName: "a",
    messageVariant: "normal",
  });
  assert.equal(
    await sendWebReminder(
      {
        endpoint: "https://web.push.apple.com/device/a",
        p256dh: "p",
        auth: "a",
        expirationTime: null,
      },
      payload,
      Date.now(),
      async () => {
        throw { statusCode: 404 };
      },
      () => true,
    ),
    "invalid",
  );
});
test("expired subscriptions are excluded", async () => {
  rows.webPushTestSubscriptionsTable[0].expirationTime = Date.now() - 1;
  assert.deepEqual(await webRecipients(["member-a"], new Date()), []);
});

test("overlapping worker ticks and an expired sending lease do not resend accepted devices", async () => {
  rows.pushTokensTable = rows.pushTokensTable.filter(
    (x) => x.platform === "web",
  );
  rows.reminderDeliveriesTable.push({
    id: "reminder-a:webpush:web-a",
    reminderId: "reminder-a",
    token: "webpush:web-a",
    status: "sending",
    leaseUntil: new Date(Date.now() - 1000),
    leaseOwner: "old",
    attempts: 1,
  });
  await Promise.all([deliverDuePhotoReminders(), deliverDuePhotoReminders()]);
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 1);
});

test("future reminders do not send early and configuration failure cannot stop native delivery", async () => {
  rows.remindersTable[0].scheduledAt = new Date(Date.now() + 60_000);
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 0);
  assert.equal(calls.expo.length, 0);
  rows.remindersTable[0].scheduledAt = new Date(Date.now() - 1000);
  vapidFailure = true;
  await deliverDuePhotoReminders();
  assert.equal(calls.expo.length, 1);
  assert.equal(calls.web.length, 0);
  assert.equal(
    rows.reminderDeliveriesTable.find((row) => row.token === "webpush:web-a")
      .status,
    "pending",
  );
});

test("revoking membership after lease acquisition cancels the web send", async () => {
  rows.pushTokensTable = rows.pushTokensTable.filter(
    (row) => row.platform === "web",
  );
  beforeTransaction = () => {
    rows.participantsTable = [];
  };
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 0);
  assert.equal(rows.reminderDeliveriesTable[0].status, "cancelled");
});

test("Expo receipt completion waits for pending web deliveries and preserves native receipt processing", async () => {
  pushFailure = { statusCode: 503 };
  await deliverDuePhotoReminders();
  rows.reminderDeliveriesTable.find(
    (row) => row.status === "ticketed",
  ).updatedAt = new Date(Date.now() - 20_000);
  await deliverDuePhotoReminders();
  assert.equal(calls.receipts.length, 1);
  assert.equal(rows.remindersTable[0].notifiedAt, null);
  pushFailure = null;
  await deliverDuePhotoReminders();
  assert.ok(rows.remindersTable[0].notifiedAt);
  assert.equal(calls.expo.length, 1);
});

test("the legacy Expo test route never forwards web subscription references", async () => {
  const response = await invoke("post", "/:experienceId/test-push");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    calls.expo[0].messages.map((row) => row.to),
    ["ExponentPushToken[native]"],
  );
  assert.equal(calls.web.length, 0);
});

test("binding route reconciles an existing subscription, then the real worker sends once without a pre-seeded web binding", async () => {
  rows.pushTokensTable = rows.pushTokensTable.filter(row => row.platform !== "web");
  const credential = "f".repeat(43);
  rows.webPushTestSubscriptionsTable[0].credentialHash = createHash("sha256").update(credential).digest("hex");
  const input = { targetRouter: webPushRouter, user: "member-a", body: {experienceId: "session-a"},
    headers: {authorization: `Bearer ${credential}`} };
  assert.equal(rows.pushTokensTable.filter(row => row.platform === "web").length, 0);
  assert.equal(calls.web.length, 0);
  const binding = await invoke("post", "/subscriptions/reminders", input);
  assert.equal(binding.statusCode, 204);
  assert.equal((await invoke("post", "/subscriptions/reminders", input)).statusCode, 204);
  const linked = rows.pushTokensTable.filter(row => row.platform === "web");
  assert.equal(linked.length, 1);
  assert.equal(linked[0].userId, "member-a");
  assert.equal(calls.web.length, 0);
  await deliverDuePhotoReminders();
  await deliverDuePhotoReminders();
  assert.equal(calls.web.length, 1);
  assert.equal(calls.web[0].payload.experienceId, "session-a");
  assert.equal(calls.web[0].payload.reminderId, "reminder-a");
  assert.equal(rows.reminderDeliveriesTable.find(row => row.token === linked[0].token).status, "accepted");
  assert.equal(calls.expo.length, 1);
});
