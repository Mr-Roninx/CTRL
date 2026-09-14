import { app } from '../src/server.js';
import { initDatabase, db, insertNotification, getNotifications, getUnreadNotificationCount } from '../src/db/database.js';
import { MigrationRunner } from '../src/db/migrations/runner.js';
import { ApiKeyService } from '../src/security/api_keys.js';
import http from 'node:http';

async function runNotificationsTest() {
  console.log('🧪 Starting Recovery Activity Notifications Test Suite...\n');

  // 1. Initialize DB
  initDatabase();
  await MigrationRunner.migrateUp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const testTenantId = `tnt_notif_${Date.now()}`;
    const insertTenantStmt = db.prepare(`
      INSERT INTO tenants (id, name, slug, environment, status, created_at)
      VALUES (?, ?, ?, 'test', 'ACTIVE', ?)
    `);
    insertTenantStmt.run(
      testTenantId,
      'Notification Test Tenant',
      `notif-test-${Date.now()}`,
      new Date().toISOString()
    );

    const keyResult = await ApiKeyService.createApiKey({
      tenantId: testTenantId,
      name: 'Notification Test Key',
      environment: 'test',
      scopes: ['events:write', 'events:read'],
    });
    const apiKey = keyResult.rawKey;

    console.log(`✅ Tenant created: ${testTenantId}`);

    // Test 1: Generate test notifications via POST /v1/notifications/test
    console.log('\nTest 1: Generating 3 test notifications...');
    const types = ['LINK_CREATED', 'PAYMENT_RECOVERED', 'SWEEP_COMPLETED'];

    let firstNotifId = '';
    for (const type of types) {
      const res = await fetch(`${baseUrl}/v1/notifications/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          type,
          title: `Test ${type}`,
          message: `Notification message for ${type}`,
          link_url: '/dashboard/opportunities',
        }),
      });

      const json = await res.json();
      if (res.status !== 201 || !json.notification_id) {
        throw new Error(`Failed to create test notification: ${JSON.stringify(json)}`);
      }
      if (!firstNotifId) firstNotifId = json.notification_id;
    }

    console.log('✅ Test 1 Passed: 3 notifications created via API');

    // Test 2: Fetch notifications via GET /v1/notifications
    console.log('\nTest 2: Querying notifications and unread count...');
    const listRes = await fetch(`${baseUrl}/v1/notifications`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const listJson = await listRes.json();
    if (listRes.status !== 200 || listJson.unread_count !== 3 || listJson.notifications.length !== 3) {
      throw new Error(`Expected 3 unread notifications, got: ${JSON.stringify(listJson)}`);
    }

    console.log(`✅ Test 2 Passed: Retrieved ${listJson.notifications.length} notifications (unread_count: ${listJson.unread_count})`);

    // Test 3: Mark single notification as read via POST /v1/notifications/:id/read
    console.log(`\nTest 3: Marking notification ${firstNotifId} as read...`);
    const readRes = await fetch(`${baseUrl}/v1/notifications/${firstNotifId}/read`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const readJson = await readRes.json();
    if (readRes.status !== 200 || readJson.unread_count !== 2) {
      throw new Error(`Expected unread_count 2 after reading 1, got ${readJson.unread_count}`);
    }
    console.log('✅ Test 3 Passed: Single notification marked as read (unread count decremented to 2)');

    // Test 4: Mark all notifications as read via POST /v1/notifications/mark-all-read
    console.log('\nTest 4: Marking all remaining notifications as read...');
    const markAllRes = await fetch(`${baseUrl}/v1/notifications/mark-all-read`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const markAllJson = await markAllRes.json();
    if (markAllRes.status !== 200 || markAllJson.unread_count !== 0) {
      throw new Error(`Expected unread_count 0, got ${markAllJson.unread_count}`);
    }
    console.log('✅ Test 4 Passed: All notifications marked as read (unread_count: 0)');

    // Verify directly in DB
    const countInDb = getUnreadNotificationCount(testTenantId);
    if (countInDb !== 0) throw new Error(`Expected 0 unread in DB, found ${countInDb}`);
    console.log('✅ DB Verification Passed: getUnreadNotificationCount returned 0');

    console.log('\n🎉 ALL RECOVERY ACTIVITY NOTIFICATIONS TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
  }
}

runNotificationsTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
