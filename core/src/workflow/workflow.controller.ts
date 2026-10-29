import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { CompleteBody, WorkflowService } from './workflow.service';

@Controller('staff')
export class WorkflowController {
  constructor(private readonly wf: WorkflowService) {}
  private p(req: AuthedRequest) { return req.session$!.principal; }

  @Get('tasks') @RequirePermission('case.read')
  list(@Req() req: AuthedRequest, @Query('queue') queue?: string, @Query('mine') mine?: string, @Query('unassigned') un?: string, @Query('status') status?: string) {
    return this.wf.listTasks(this.p(req), { queue, mine: mine === 'true', unassigned: un === 'true', status });
  }
  @Get('tasks/:id/authority') @RequirePermission('case.read')
  authority(@Req() req: AuthedRequest, @Param('id') id: string) { return this.wf.authorityPreview(this.p(req), id); }
  @Post('tasks/:id/claim') @HttpCode(200) @RequirePermission('case.read')
  claim(@Req() req: AuthedRequest, @Param('id') id: string) { return this.wf.claim(this.p(req), id); }
  @Post('tasks/:id/release') @HttpCode(200) @RequirePermission('case.read')
  release(@Req() req: AuthedRequest, @Param('id') id: string) { return this.wf.release(this.p(req), id); }
  @Post('tasks/:id/assign') @HttpCode(200) @RequirePermission('case.assign')
  assign(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { userId?: string }) { return this.wf.assign(this.p(req), id, String(b.userId ?? '')); }
  @Post('tasks/:id/complete') @HttpCode(201) @RequirePermission('case.read')
  complete(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: CompleteBody, @Headers('idempotency-key') ik?: string) { return this.wf.complete(this.p(req), id, b, ik); }
  @Get('tat/summary') @RequirePermission('tat.read')
  tatSummary(@Req() req: AuthedRequest, @Query('service') service?: string) { return this.wf.dashboard(this.p(req), service); }
  @Get('cases/:id/workspace') @RequirePermission('case.read')
  workspace(@Req() req: AuthedRequest, @Param('id') id: string) { return this.wf.workspace(this.p(req), id); }
}

@Controller('ops')
export class OpsController {
  constructor(private readonly wf: WorkflowService) {}
  /** Run by the scheduler's integration identity; moves overdue tasks to their escalation path once. */
  @Post('escalations/run') @HttpCode(200) @RequirePermission('integration.invoke')
  run(@Req() req: AuthedRequest) { return this.wf.runDueEscalations(req.session$!.principal.institutionId); }
}
