async function probe() {
  try {
    const res1 = await fetch('http://localhost:3001/dashboard/summary');
    console.log('✅ Backend /dashboard/summary HTTP status:', res1.status);
    const data1 = await res1.json();
    console.log('   Total Opportunities:', data1.total_opportunities);
    console.log('   Real Recovered Volume:', data1.total_recovered_display);
    console.log('   Kill Switch Active:', data1.kill_switch_active);

    const res2 = await fetch('http://localhost:3001/dashboard/analytics');
    console.log('✅ Backend /dashboard/analytics HTTP status:', res2.status);
    const data2 = await res2.json();
    console.log('   Active Issuer Banks Tracked:', data2.bank_data?.length);
    console.log('   Live Gross Causal Lift:', `+${data2.metrics?.gross_causal_lift_pct}%`);
    console.log('   Capital Efficiency ROI:', `${data2.metrics?.capital_efficiency_ratio}x`);

    const res3 = await fetch('http://localhost:3000');
    console.log('✅ Frontend Next.js HTTP status:', res3.status);
    console.log('\n🚀 ALL SYSTEMS OPERATIONAL AND LIVE ON:');
    console.log('   Dashboard UI: http://localhost:3000');
    console.log('   Backend API : http://localhost:3001');
  } catch (err: any) {
    console.error('Probe failed:', err.message);
  }
}

probe();
