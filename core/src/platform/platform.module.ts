import { Global, Module } from '@nestjs/common';
import { Db } from './db';
import { Idempotency } from './idempotency';

@Global()
@Module({ providers: [Db, Idempotency], exports: [Db, Idempotency] })
export class PlatformModule {}
