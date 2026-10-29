import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService, ConfigValidatorRegistry } from '../configuration';
import { formValidator } from './form-publish-checks';
import { FormDef, ValidationOutcome } from './form-schema';
import { validateForm } from './form-engine';

export interface PinnedForm { versionId: string; key: string; version: number; def: FormDef }

/** Resolves and applies published forms. Cases and drafts pin a version id and keep using it after newer versions publish (FRM-03, WFL-07). */
@Injectable()
export class FormsService implements OnModuleInit {
  constructor(private readonly config: ConfigService, private readonly validators: ConfigValidatorRegistry) {}
  onModuleInit() { this.validators.register(formValidator); }

  async currentFor(institutionId: string, formKey: string): Promise<PinnedForm> {
    const v = await this.config.getPublished(institutionId, 'form', formKey);
    if (!v) throw new NotFoundException();
    return { versionId: v.id, key: formKey, version: v.version, def: v.content as unknown as FormDef };
  }

  async pinned(institutionId: string, versionId: string): Promise<PinnedForm> {
    const v = await this.config.getPinnedVersion(institutionId, 'form', versionId);
    if (!v) throw new NotFoundException();
    return { versionId: v.id, key: v.key, version: v.version, def: v.content as unknown as FormDef };
  }

  validate(form: PinnedForm, data: unknown): ValidationOutcome { return validateForm(form.def, data); }
}
