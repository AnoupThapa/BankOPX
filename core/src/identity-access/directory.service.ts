import { Injectable } from '@nestjs/common';
import { Tx } from '../platform';

/** Identity and organisation directory operations other modules need, kept behind identity-access (ADR-002). */
@Injectable()
export class DirectoryService {
  /** Creates the customer-type identity (SEC-07) and its self-service role. Callers audit. */
  async createCustomerIdentity(tx: Tx, institutionId: string): Promise<string> {
    const uid = (await tx.query(`INSERT INTO user_account (institution_id, actor_type, username) VALUES ($1,'customer', 'cust-' || gen_random_uuid()) RETURNING id`, [institutionId])).rows[0].id as string;
    await tx.query(`INSERT INTO role_assignment (institution_id, user_id, role, granted_by, approved_by) VALUES ($1,$2,'customer',$2,$2)`, [institutionId, uid]);
    return uid;
  }

  async branchIdByCode(tx: Tx, code: string): Promise<string | null> {
    return (await tx.query('SELECT id FROM branch WHERE code=$1', [code])).rows[0]?.id ?? null;
  }
}
