const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is missing.');
    }
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }
  return pool;
}

module.exports = {
  query: (text, params) => {
    return getPool().query(text, params);
  },
  connect: () => {
    return getPool().connect();
  },
  end: () => {
    if (pool) {
      return pool.end();
    }
    return Promise.resolve();
  }
};
