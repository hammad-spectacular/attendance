/**
 * SECURE PASSWORD RECOVERY SCRIPT
 * 
 * This script securely resets the password for the Test Admin account.
 * It uses the same bcrypt hashing method as the application (12 rounds).
 * 
 * TARGET ACCOUNT:
 * - ID: 1
 * - Login ID: ADM
 * - Name: Test Admin
 * - Role: admin
 * - Tenant ID: TEST
 * 
 * SECURITY FEATURES:
 * - Uses bcrypt with 12 salt rounds (same as application)
 * - Increments token_generation to invalidate all existing sessions
 * - Does not log or expose the new password
 * - One-time use script
 * 
 * USAGE: 
 * 1. Set your desired new password in the NEW_PASSWORD variable below
 * 2. Run: node recover-admin-password.js
 * 3. Delete this script after use
 */

require('dotenv').config();
const pool = require('./db.js');
const bcrypt = require('bcrypt');

// ============================================================
// SET YOUR NEW PASSWORD HERE (minimum 8 characters, 1 special char)
// ============================================================
const NEW_PASSWORD = 'CHANGE_ME_TO_YOUR_NEW_PASSWORD';

// ============================================================
// VALIDATION
// ============================================================
function validatePassword(password) {
  if (!password || password.length < 8) {
    console.error('ERROR: Password must be at least 8 characters');
    return false;
  }
  const specialChars = /[!@#$%^&*(),.?":{}|<>]/;
  if (!specialChars.test(password)) {
    console.error('ERROR: Password must contain at least one special character (!@#$%^&*(),.?":{}|<>)');
    return false;
  }
  return true;
}

// ============================================================
// RECOVERY PROCEDURE
// ============================================================
async function recoverPassword() {
  const client = await pool.connect();
  
  try {
    // Validate password
    if (!validatePassword(NEW_PASSWORD)) {
      console.error('Password validation failed. Please update NEW_PASSWORD and try again.');
      return;
    }

    // Check if NEW_PASSWORD is still the placeholder
    if (NEW_PASSWORD === 'CHANGE_ME_TO_YOUR_NEW_PASSWORD') {
      console.error('ERROR: Please set your desired password in the NEW_PASSWORD variable before running this script.');
      return;
    }

    console.log('Starting secure password recovery for Test Admin account...');
    console.log('Target: ID=1, login_id=ADM, tenant_id=TEST');

    // Begin transaction
    await client.query('BEGIN');

    // Hash the new password using bcrypt with 12 rounds (same as application)
    const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12');
    const passwordHash = await bcrypt.hash(NEW_PASSWORD, BCRYPT_ROUNDS);

    // Update the admin account with new password hash and increment token_generation
    const result = await client.query(
      `UPDATE admins 
       SET password_hash = $1, 
           is_first_login = false, 
           token_generation = COALESCE(token_generation, 0) + 1 
       WHERE id = 1 AND login_id = 'ADM' AND tenant_id = 'TEST'
       RETURNING id, login_id, name, role, tenant_id, token_generation`,
      [passwordHash]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      console.error('ERROR: Target account not found or criteria mismatch.');
      return;
    }

    const updatedAccount = result.rows[0];
    
    // Commit transaction
    await client.query('COMMIT');

    console.log('\n✓ PASSWORD RECOVERY SUCCESSFUL\n');
    console.log('Updated account details:');
    console.log(`- ID: ${updatedAccount.id}`);
    console.log(`- Login ID: ${updatedAccount.login_id}`);
    console.log(`- Name: ${updatedAccount.name}`);
    console.log(`- Role: ${updatedAccount.role}`);
    console.log(`- Tenant ID: ${updatedAccount.tenant_id}`);
    console.log(`- New Token Generation: ${updatedAccount.token_generation}`);
    console.log('\nAll existing sessions have been invalidated.');
    console.log('You can now log in with your new password.\n');
    console.log('IMPORTANT: Delete this script after successful recovery.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERROR during password recovery:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

recoverPassword();
