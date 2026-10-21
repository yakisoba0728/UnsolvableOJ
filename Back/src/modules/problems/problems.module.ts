import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Problem } from './problem.entity.js';
import { ProblemsController } from './problems.controller.js';
import { ProblemsService } from './problems.service.js';
import { TestCase } from './test-case.entity.js';

@Module({
  imports: [
    PassportModule.register({}),
    TypeOrmModule.forFeature([Problem, TestCase]),
  ],
  controllers: [ProblemsController],
  providers: [ProblemsService],
})
export class ProblemsModule {}
