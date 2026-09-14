import {
  initDatabase,
  db,
  insertOpportunity,
  updateOpportunityStatus,
  getNotifications,
  getUnreadNotificationCount,
  insertNotification,
  getOpportunityById,
} from '../src/db/database.js';
import { normalizeOpportunity } from '../src/perception/normalizer.js';
import { RealtimeBroadcaster } from '../src/realtime/broadcaster.js';

async function testTargetedDaemonNotifications() {
  console.log('🧪 Starting Targeted Tenant Daemon Notifications Test Suite...\n');

  initDatabase();

  const merchantTenantId = `tnt_target_notif_${Date.now()}`;
  const oppId = `pay_notif_target_${Date.now()}`;

  // 1. Create merchant tenant
  const insertTenant = db.prepare(`
    INSERT INTO tenants (id, name, slug, environment, status, created_at)
    VALUES (?, ?, ?, 'test', 'ACTIVE', ?)
  `);
  insertTenant.run(merchantTenantId, 'Targeted Store', `target-store-${Date.now()}`, new Date().toISOString());

  // 2. Create opportunity for this tenant
  const opp = normalizeOpportunity(
    {
      id: oppId,
      amount: 120000, // ₹1,200
      currency: 'INR',
      error_code: 'INSUFFICIENT_FUNDS',
      customer_id: 'target_cust@example.com',
    },
    `evt_target_notif_${Date.now()}`,
    { source: 'synthetic', tenantId: merchantTenantId }
  );
  insertOpportunity(opp);

  console.log(`✅ Seeded opportunity ${oppId} for tenant ${merchantTenantId}`);

  // 3. Simulate daemon reconciliation logic
  const savedOpp = getOpportunityById(oppId);
  if (!savedOpp) throw new Error('Opportunity not found');

  const notifItem = {
    id: `notif_target_test_${Date.now()}`,
    tenant_id: savedOpp.tenant_id,
    type: 'PAYMENT_RECOVERED' as const,
    title: 'Payment Successfully Recovered! 🎉',
    message: `Opportunity ${savedOpp.id} (₹${(savedOpp.amount_paise / 100).toFixed(2)}) settled and verified via Razorpay API.`,
    link_url: '/dashboard/opportunities',
    created_at: new Date().toISOString(),
  };

  insertNotification(notifItem);

  // Broadcast to tenant
  RealtimeBroadcaster.getInstance().broadcastToTenant(merchantTenantId, 'NOTIFICATION_CREATED', notifItem);

  // 4. Verify that merchant tenant queries retrieve the targeted notification
  const merchantNotifs = getNotifications(merchantTenantId);
  const unreadCount = getUnreadNotificationCount(merchantTenantId);

  console.log(`Retrieved ${merchantNotifs.length} notifications for tenant ${merchantTenantId} (unread: ${unreadCount})`);

  if (merchantNotifs.length !== 1 || unreadCount !== 1) {
    throw new Error(`Expected 1 unread notification for ${merchantTenantId}, got ${unreadCount}`);
  }

  if (merchantNotifs[0].tenant_id !== merchantTenantId) {
    throw new Error(`Expected tenant_id ${merchantTenantId}, got ${merchantNotifs[0].tenant_id}`);
  }

  // 5. Verify that another tenant does NOT see this notification
  const otherTenantNotifs = getNotifications('other_random_tenant');
  if (otherTenantNotifs.length !== 0) {
    throw new Error('Tenant isolation breach in notifications');
  }

  console.log('✅ Test 1 Passed: Notification correctly routed to merchant tenant');
  console.log('✅ Test 2 Passed: Isolation verified across other tenants');

  console.log('\n🎉 ALL TARGETED DAEMON NOTIFICATION TESTS PASSED CLEANLY!');
}

testTargetedDaemonNotifications().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
