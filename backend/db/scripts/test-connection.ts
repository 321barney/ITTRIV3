// db/scripts/test-connection.ts
import { testDbConnection, closeDb } from '../index.js';

async function testDatabase(): Promise<void> {
  try {
    console.log('🔍 Testing database connection...');
    await testDbConnection();
    console.log('✅ Database test passed!');
  } catch (error: any) {
    console.error('❌ Database test failed:', error.message);
    throw error;
  } finally {
    await closeDb();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { testDatabase };