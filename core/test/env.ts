process.env.DATABASE_URL = 'postgres://bbjp_app:dev_app_pw@localhost:5432/bbjp_test';
process.env.MIGRATION_DATABASE_URL = 'postgres://bbjp_owner:dev_owner_pw@localhost:5432/bbjp_test';
process.env.FIELD_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // test-only key
process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_MAX = '1000';
process.env.LOOKUP_HMAC_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'; // test-only key
process.env.TRUST_PROXY = 'true'; // tests give each simulated client its own address via X-Forwarded-For
process.env.OTP_ROUTE_RATE_MAX = '100000';
