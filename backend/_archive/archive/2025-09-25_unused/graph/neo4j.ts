import neo4j, { Driver, Session } from 'neo4j-driver';

const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USER;
const pass = process.env.NEO4J_PASS;

let _driver: Driver | null = null;

export function getDriver(): Driver {
  if (!_driver) {
    if (!uri || !user || !pass) {
      throw new Error('NEO4J_URI/USER/PASS env vars are required');
    }
    _driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
  }
  return _driver;
}

export async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const session = getDriver().session();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function upsertProduct(p: { id: string; name: string; price?: number; category?: string | null }) {
  return withSession((s) => s.run(
    `MERGE (pr:Product {id:$id})
     SET pr.name=$name, pr.price=$price
     WITH pr
     CALL {
       WITH pr
       WITH pr WHERE $category IS NOT NULL
       MERGE (c:Category {name:$category})
       MERGE (c)-[:HAS_PRODUCT]->(pr)
       RETURN 1
     }
     RETURN pr`,
    { id: p.id, name: p.name, price: p.price ?? null, category: p.category ?? null }
  ));
}
