import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { ApprovalDecisionDto, ApprovalsQueryDto } from './dto/run.dto';
import { RunbookApprovalsService } from './runbook-approvals.service';

@ApiTags('Runbooks')
@Controller('runbook-approvals')
export class RunbookApprovalsController {
  constructor(private readonly approvals: RunbookApprovalsService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiResponse({ status: 200, description: 'Paginated approvals with `allowSelfApproval`; `{ count }` only with `count=true`' })
  @ApiOperation({ summary: 'The approval inbox; `status=pending` by default. Deciding needs runbooks:approve (requires runbooks:read)' })
  list(@CurrentPrincipal() principal: Principal, @Query() query: ApprovalsQueryDto) {
    return this.approvals.list(principal, query);
  }

  @Post(':id/decision')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_APPROVE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a pending approval (requires runbooks:approve)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ id, status }`' })
  @ApiResponse({ status: 403, description: 'RUNBOOK_SELF_APPROVAL: you started this run' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_APPROVAL_NOT_PENDING' })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.approvals.decide(principal, id, dto.decision, dto.comment);
  }
}
