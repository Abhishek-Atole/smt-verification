const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const client = new Client({ 
    connectionString: 'postgresql://smtverify:UCAL%40%23%24_2030@localhost:5432/smtverification' 
  });

  await client.connect();

  const users = [
    { username: 'operator1', password: 'operator123', role: 'operator', name: 'Operator 1' },
    { username: 'qa1', password: 'qa123', role: 'qa', name: 'QA Engineer 1' },
    { username: 'engineer1', password: 'engineer123', role: 'engineer', name: 'Engineer 1' }
  ];

  for (const user of users) {
    const hash = await bcrypt.hash(user.password, 10);
    await client.query('DELETE FROM users WHERE username = $1', [user.username]);
    const result = await client.query(
      'INSERT INTO users (username, password, role, name, display_name, is_active) VALUES ($1, $2, $3, $4, $5, true) RETURNING username',
      [user.username, hash, user.role, user.name, user.name]
    );
    console.log(`Created ${user.username}`);
  }

  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
