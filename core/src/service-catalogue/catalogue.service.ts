import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService, ConfigValidatorRegistry } from '../configuration';
import { SessionInfo } from '../identity-access';
import { ProfileService } from '../customer-profile';
import { serviceValidator } from './service-schema';

export interface CatalogueFilter { channel?: string; branch?: string; currency?: string; segment?: string }
const matches = (list: unknown, v?: string) => Array.isArray(list) && (list.includes('*') || (v !== undefined && list.includes(v)));

@Injectable()
export class CatalogueService implements OnModuleInit {
  constructor(private readonly config: ConfigService, private readonly validators: ConfigValidatorRegistry, private readonly profiles: ProfileService) {}
  onModuleInit() { this.validators.register(serviceValidator); }

  /** SVC-06: a service is listed only where its availability covers the caller's channel/branch/currency/segment. */
  async list(s: SessionInfo, f: CatalogueFilter) {
    const inst = s.principal.institutionId;
    const linked = await this.profiles.isLinked(inst, s.principal.userId);
    const all = await this.config.listPublished(inst, 'service');
    return all.filter((v) => {
      const a = v.content.availability as Record<string, unknown>;
      return matches(a.channels, f.channel) && matches(a.branches, f.branch) && matches(a.currencies, f.currency) && matches(a.segments, f.segment);
    }).map((v) => this.view(v, linked));
  }

  async get(s: SessionInfo, key: string) {
    const inst = s.principal.institutionId;
    const v = (await this.config.listPublished(inst, 'service')).find((x) => x.key === key);
    if (!v) throw new NotFoundException();
    return this.view(v, await this.profiles.isLinked(inst, s.principal.userId));
  }

  private view(v: { id: string; key: string; version: number; content: Record<string, unknown> }, linked: boolean) {
    const c = v.content;
    return {
      key: v.key, version: v.version, serviceVersionId: v.id, formKey: (c.formKey as string | undefined) ?? null,
      title: c.title, description: c.description, whoCanApply: c.whoCanApply, fees: c.fees, documents: c.documents, supportChannel: c.supportChannel,
      indicativeTat: c.indicativeTat ?? null, signatureSupport: c.signatureSupport,
      remoteClass: c.remoteClass, visitReason: c.visitReason ?? null,                 // SVC-01/02: shown before the application starts
      requiresExistingRelationship: c.requiresExistingRelationship, canStart: !c.requiresExistingRelationship || linked,
      submissionIsNotApproval: true,                                                   // SVC-04: server-enforced, not a config option
    };
  }
}
