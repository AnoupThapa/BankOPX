process.env.DATABASE_URL = 'postgres://bbjp_app:dev_app_pw@localhost:5432/bbjp_test';
process.env.MIGRATION_DATABASE_URL = 'postgres://bbjp_owner:dev_owner_pw@localhost:5432/bbjp_test';
process.env.FIELD_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // test-only key
process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_MAX = '1000';
