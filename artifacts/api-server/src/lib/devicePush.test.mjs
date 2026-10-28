import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeviceCredential,
  deviceCredentialMatches,
  hashDeviceCredential,
  isAllowedWebPushEndpoint,
  sendAuthorizedDeviceTest,
} from './devicePush.ts';

test('device credential is random, persisted as a hash, and verifies only its matching value', () => {
  const credential = createDeviceCredential();
  const hash = hashDeviceCredential(credential);
  assert.equal(credential.length >= 40, true);
  assert.notEqual(hash, credential);
  assert.equal(deviceCredentialMatches(credential, hash), true);
  assert.equal(deviceCredentialMatches(`${credential}x`, hash), false);
});

test('only HTTPS push service endpoints are accepted', () => {
  assert.equal(isAllowedWebPushEndpoint('https://web.push.apple.com/device/example'), true);
  assert.equal(isAllowedWebPushEndpoint('https://fcm.googleapis.com/fcm/send/example'), true);
  assert.equal(isAllowedWebPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example'), true);
  assert.equal(isAllowedWebPushEndpoint('http://fcm.googleapis.com/fcm/send/example'), false);
  assert.equal(isAllowedWebPushEndpoint('https://127.0.0.1/private'), false);
  assert.equal(isAllowedWebPushEndpoint('https://attacker.example/push'), false);
  assert.equal(isAllowedWebPushEndpoint('https://user:pass@fcm.googleapis.com/path'), false);
});

test('valid device credential invokes the provider for only the stored endpoint', async () => {
  const credential = createDeviceCredential();
  const endpoint = 'https://web.push.apple.com/device/one';
  let sends = 0;
  const result = await sendAuthorizedDeviceTest({
    credential,
    expectedCredentialHash: hashDeviceCredential(credential),
    requestedEndpoint: endpoint,
    storedEndpoint: endpoint,
    send: async () => { sends += 1; return 'accepted'; },
  });
  assert.deepEqual(result, { authorized: true, result: 'accepted' });
  assert.equal(sends, 1);
});

test('invalid credential or mismatched endpoint never invokes the push provider', async () => {
  const credential = createDeviceCredential();
  const expectedCredentialHash = hashDeviceCredential(credential);
  let sends = 0;
  const denied = await sendAuthorizedDeviceTest({
    credential: `${credential}wrong`, expectedCredentialHash,
    requestedEndpoint: 'https://web.push.apple.com/device/one',
    storedEndpoint: 'https://web.push.apple.com/device/one',
    send: async () => { sends += 1; },
  });
  const mismatch = await sendAuthorizedDeviceTest({
    credential, expectedCredentialHash,
    requestedEndpoint: 'https://web.push.apple.com/device/two',
    storedEndpoint: 'https://web.push.apple.com/device/one',
    send: async () => { sends += 1; },
  });
  assert.deepEqual(denied, { authorized: false });
  assert.deepEqual(mismatch, { authorized: false });
  assert.equal(sends, 0);
});
