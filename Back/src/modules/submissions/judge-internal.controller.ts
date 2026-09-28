import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JudgeResultDto } from './dto/judge-result.dto.js';
import { JudgeTokenGuard } from './judge-token.guard.js';
import { SubmissionsService } from './submissions.service.js';

@ApiTags('judge-internal')
@ApiHeader({ name: 'X-Judge-Token', required: true })
@SkipThrottle()
@UseGuards(JudgeTokenGuard)
@Controller('internal/judge')
export class JudgeInternalController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('heartbeat')
  heartbeat(@Headers('x-judge-worker') workerId: string) {
    return this.submissionsService.heartbeat(workerId);
  }

  @Get('submissions/:id')
  claim(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-judge-generation') generation: string,
    @Headers('x-judge-attempt') attemptId: string,
  ) {
    return this.submissionsService.claimForJudge(
      id,
      Number(generation),
      attemptId,
    );
  }

  @Patch('submissions/:id/heartbeat')
  renewLease(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-judge-generation') generation: string,
    @Headers('x-judge-attempt') attemptId: string,
  ) {
    return this.submissionsService.renewLease(
      id,
      Number(generation),
      attemptId,
    );
  }

  @Patch('submissions/:id/result')
  recordResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-judge-generation') generation: string,
    @Headers('x-judge-attempt') attemptId: string,
    @Body() dto: JudgeResultDto,
  ) {
    return this.submissionsService.recordJudgeResult(
      id,
      Number(generation),
      attemptId,
      dto,
    );
  }
}
