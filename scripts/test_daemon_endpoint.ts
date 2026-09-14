async function main() {
  try {
    console.log('Sending OPTIONS preflight to http://localhost:3001/agents/daemon/status ...');
    const res = await fetch('http://localhost:3001/agents/daemon/status', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });
    console.log('OPTIONS Status:', res.status);
    console.log('Access-Control-Allow-Origin:', res.headers.get('access-control-allow-origin'));
    console.log('Access-Control-Allow-Headers:', res.headers.get('access-control-allow-headers'));
    console.log('Access-Control-Allow-Methods:', res.headers.get('access-control-allow-methods'));
  } catch (err: any) {
    console.error('OPTIONS failed:', err.message);
  }
}

main();
