import { PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsPostgresText } from '../../../common/postgres-text.js';

export class CreateEnterpriseTestDto {
  @IsString()
  @Length(1, 60)
  @IsPostgresText()
  title: string;

  @IsString()
  @MaxLength(300)
  @IsPostgresText()
  description = '';

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsInt()
  @Min(10)
  @Max(600)
  durationMin: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  problemIds: string[];
}

export class UpdateEnterpriseTestDto extends PartialType(CreateEnterpriseTestDto) {}
