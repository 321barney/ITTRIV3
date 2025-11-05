// db/scripts/verify-setup.ts
import { testDbConnection, getDb, closeDb } from '../index.js';

async function verifySetup() {
  try {
    console.log('🔍 Verifying database setup...');

    await testDbConnection();

    const db = getDb();
    if (db) {
      const tables = await db.raw(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);

      console.log('📊 Tables found:');
      tables.rows.forEach((row: any) => console.log(`  ✓ ${row.table_name}`));

      try {
        const plans = await db.select('code', 'name', 'monthly_price').from('plans');
        console.log('💰 Plans available:');
        plans.forEach(plan => console.log(`  ✓ ${plan.code}: ${plan.name} ($${plan.monthly_price})`));
      } catch (e) {
        console.warn('⚠️  Plans table not accessible - may need migration');
      }

      console.log('✅ Database setup verified successfully!');
    }
  } catch (error) {
    console.error('❌ Setup verification failed:', error);
    throw error;
  } finally {
    await closeDb();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifySetup()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { verifySetup };