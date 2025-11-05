import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const url = 'postgresql://neondb_owner:npg_TsCZmdwXjG79@ep-royal-forest-adm1st1g-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require';

const client = new Client({ 
    connectionString: url,
    ssl: { rejectUnauthorized: false }
});

try {
    await client.connect();
    console.log('Connected to Neon database ✅');
    
    // Apply schema if needed
    const sql = readFileSync('schema_fresh.sql', 'utf8');
    const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--') && s.length > 5);

    console.log('Applying schema...');
    for (let i = 0; i < statements.length; i++) {
        try {
            await client.query(statements[i]);
            if (i % 10 === 0) console.log(`✔ ${i+1}/${statements.length}`);
        } catch (e) {
            if (!e.message.includes('already exists')) {
                console.error(`✘ Error at statement ${i+1}:`, e.message);
            }
        }
    }
    
    // Check tables
    const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
    console.log('Tables created:', result.rows.map(r => r.table_name));
    
    // Check plans
    const plans = await client.query("SELECT code, name FROM plans;");
    console.log('Plans available:', plans.rows);
    
} catch (error) {
    console.error('Error:', error.message);
} finally {
    await client.end();
}
