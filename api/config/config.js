require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USER || 'pbx_api',
    password: process.env.DB_PASSWORD || 'changeme',
    database: process.env.DB_NAME || 'pbx_api_db',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: process.env.DB_DIALECT || 'mariadb',
    logging: false,
    define: {
      timestamps: true,
      underscored: false,
      freezeTableName: true
    }
  },
  test: {
    username: process.env.DB_USER || 'pbx_api',
    password: process.env.DB_PASSWORD || 'changeme',
    database: process.env.DB_NAME || 'pbx_api_db',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: process.env.DB_DIALECT || 'mariadb',
    logging: false
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: process.env.DB_DIALECT || 'mariadb',
    logging: false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
};
