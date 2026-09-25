const http = require('http');

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : body;
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testAPIEndpoints() {
  console.log('🧪 Testing live API endpoints...\n');

  const baseUrl = 'localhost';
  const port = 3000;

  // Test 1: GET /api/fees/payments
  console.log('📡 Testing GET /api/fees/payments:');
  try {
    const result = await makeRequest({
      hostname: baseUrl,
      port: port,
      path: '/api/fees/payments',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    console.log(`Status: ${result.status}`);
    if (result.status === 200) {
      console.log('✅ API is responding');
      console.log(`Returned ${Array.isArray(result.data) ? result.data.length : 'non-array'} records`);
      if (Array.isArray(result.data) && result.data.length > 0) {
        console.log('Sample record:', result.data[0]);
      }
    } else if (result.status === 401) {
      console.log('✅ Endpoint exists but requires authentication');
    } else {
      console.log('❌ Unexpected response:', result.data);
    }
  } catch (error) {
    console.log('❌ Request failed:', error.message);
  }

  // Test 2: POST /api/fees/payments (will likely fail without auth, but shows if endpoint exists)
  console.log('\n📡 Testing POST /api/fees/payments (without auth):');
  try {
    const result = await makeRequest({
      hostname: baseUrl,
      port: port,
      path: '/api/fees/payments',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    }, {
      student_id: 23,
      month: '2025-10',
      amount_due: 6000,
      amount_paid: 6000,
      payment_method: 'cash',
      payment_date: '2025-09-25',
      notes: 'API test'
    });
    
    console.log(`Status: ${result.status}`);
    if (result.status === 401) {
      console.log('✅ Endpoint exists but requires authentication (expected)');
    } else {
      console.log('Response:', result.data);
    }
  } catch (error) {
    console.log('❌ Request failed:', error.message);
  }

  // Test 3: GET /api/fees/structures
  console.log('\n📡 Testing GET /api/fees/structures:');
  try {
    const result = await makeRequest({
      hostname: baseUrl,
      port: port,
      path: '/api/fees/structures',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    console.log(`Status: ${result.status}`);
    if (result.status === 200) {
      console.log('✅ API is responding');
      console.log(`Returned ${Array.isArray(result.data) ? result.data.length : 'non-array'} structures`);
      if (Array.isArray(result.data) && result.data.length > 0) {
        console.log('Sample structure:', result.data[0]);
      }
    } else if (result.status === 401) {
      console.log('✅ Endpoint exists but requires authentication');
    } else {
      console.log('❌ Unexpected response:', result.data);
    }
  } catch (error) {
    console.log('❌ Request failed:', error.message);
  }

  console.log('\n🔍 If all endpoints return 401, the API is working but requires authentication');
  console.log('If endpoints return 404, the routes might not be properly registered');
  console.log('If requests fail completely, the server might not be serving the API correctly');
}

testAPIEndpoints();
