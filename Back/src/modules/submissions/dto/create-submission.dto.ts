import { IsEnum, IsString, Length } from 'class-validator';
import { IsPostgresText } from '../../../common/postgres-text.js';
import { SubmissionLanguage } from '../submission.enums.js';

export class CreateSubmissionDto {
  @IsEnum(SubmissionLanguage)
  language: SubmissionLanguage;

  @IsString()
  @Length(1, 200_000)
  @IsPostgresText()
  sourceCode: string;
}
