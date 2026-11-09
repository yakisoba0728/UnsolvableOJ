import { PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsPostgresText } from '../../../common/postgres-text.js';

export const MAX_INVITEES = 200;

// 기본값은 서비스에서 채운다. 필드 초기값을 두면 PartialType이 수정 DTO에도 물려줘
// 수정 요청에서 보내지 않은 필드가 초기값으로 덮인다.
export class CreateEnterpriseTestDto {
  @IsString()
  @Length(1, 60)
  @IsPostgresText()
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @IsPostgresText()
  description?: string;

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

  /** true면 invitees에 적은 사람만 응시 링크를 열 수 있다. */
  @IsOptional()
  @IsBoolean()
  inviteOnly?: boolean;

  /** 사용자 이름 또는 이메일('@'가 있으면 이메일). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_INVITEES)
  @IsString({ each: true })
  @Length(1, 320, { each: true })
  @IsPostgresText({ each: true })
  invitees?: string[];

  /** 응시를 마친 응시자에게 자기 점수를 보여 줄지. */
  @IsOptional()
  @IsBoolean()
  showScoreToCandidates?: boolean;
}

export class UpdateEnterpriseTestDto extends PartialType(CreateEnterpriseTestDto) {}
