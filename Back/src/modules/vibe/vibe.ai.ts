import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, jsonSchema, Output } from 'ai';
import Joi from 'joi';
import { validateFiles } from './vibe.catalog.js';
import { attemptSnapshot } from './vibe.snapshot.js';
import type {
  ProjectFiles,
  ReviewSection,
  VibeAttemptRow,
} from './vibe.types.js';

interface AssistantOutput {
  text: string;
  files: { path: string; content: string }[];
}
const sectionSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    score: { type: 'integer' as const },
    feedback: {
      type: 'string' as const,
      description: '한국어로 작성한 구체적인 학습 피드백',
    },
    evidence: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['score', 'feedback', 'evidence'],
};
const sectionValidator = Joi.object({
  score: Joi.number().integer().min(0).max(30).required(),
  feedback: Joi.string().max(3000).required(),
  evidence: Joi.array().items(Joi.string().uuid()).max(10).required(),
});
const safeText = (text: string) => text.replace(/[\0\p{Cs}]/gu, '\uFFFD');

@Injectable()
export class VibeAi {
  constructor(private readonly config: ConfigService) {}
  get available() {
    return Boolean(this.config.get<string>('OPENAI_API_KEY'));
  }
  get model() {
    return this.config.get<string>('VIBE_AI_MODEL', 'gpt-6-luna');
  }

  private settings(model: string) {
    if (!this.available)
      throw new ServiceUnavailableException(
        '코딩 파트너 연결이 아직 설정되지 않았습니다.',
      );
    return {
      model: createOpenAI({
        apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      }).responses(model),
      providerOptions: { openai: { reasoningEffort: 'medium', store: false } },
      maxOutputTokens: 8192,
      timeout: 60_000,
      maxRetries: 0,
    };
  }

  async assist(
    attempt: VibeAttemptRow,
  ): Promise<{ text: string; files: ProjectFiles }> {
    const content = attemptSnapshot(attempt);
    const editablePaths = content.editablePaths;
    try {
      const { output } = await generateText({
        ...this.settings(attempt.model),
        system: content.assistSystem,
        prompt: JSON.stringify({
          task: content.challenge,
          files: { ...content.initialFiles, ...attempt.state.files },
          conversation: attempt.state.messages
            .slice(-12)
            .map(({ id, role, text }) => ({ id, role, text })),
          publicRuns: attempt.state.runs.slice(-3),
        }),
        output: Output.object({
          schema: jsonSchema<AssistantOutput>(
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: {
                  type: 'string',
                  description:
                    '한국어로 작성한 답변. 코드 식별자만 원문을 유지합니다.',
                },
                files: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      path: { type: 'string', enum: editablePaths },
                      content: { type: 'string' },
                    },
                    required: ['path', 'content'],
                  },
                },
              },
              required: ['text', 'files'],
            },
            {
              validate: (value) => {
                const checked = Joi.object({
                  text: Joi.string()
                    .max(6000)
                    .pattern(/[가-힣]/u)
                    .required(),
                  files: Joi.array()
                    .items(
                      Joi.object({
                        path: Joi.string()
                          .valid(...editablePaths)
                          .required(),
                        content: Joi.string().allow('').max(30_000).required(),
                      }),
                    )
                    .max(3)
                    .unique('path')
                    .required(),
                }).validate(value);
                return checked.error
                  ? { success: false, error: checked.error }
                  : { success: true, value: checked.value as AssistantOutput };
              },
            },
          ),
        }),
      });
      return {
        text: safeText(output.text),
        files: validateFiles(
          Object.fromEntries(
            output.files.map((file) => [file.path, file.content]),
          ),
          true,
          editablePaths,
        ),
      };
    } catch {
      throw new ServiceUnavailableException(
        '답변을 받지 못했습니다. 코드는 저장되어 있으며 다시 질문할 수 있습니다.',
      );
    }
  }

  async evaluate(
    attempt: VibeAttemptRow,
    reflection: string,
  ): Promise<{ prompt: ReviewSection; process: ReviewSection }> {
    const content = attemptSnapshot(attempt);
    const evidenceIds = new Set([
      ...attempt.state.messages.map((m) => m.id),
      ...attempt.state.events.map((e) => e.id),
      ...attempt.state.runs.map((r) => r.id),
    ]);
    const evidenceSectionSchema = {
      ...sectionSchema,
      properties: {
        ...sectionSchema.properties,
        evidence: {
          type: 'array' as const,
          items: { type: 'string' as const, enum: [...evidenceIds] },
        },
      },
    };
    const { output } = await generateText({
      ...this.settings(attempt.model),
      system: content.reviewSystem,
      prompt: JSON.stringify({
        task: content.challenge,
        initialFiles: content.initialFiles,
        finalFiles: attempt.state.files,
        messages: attempt.state.messages.map(({ id, role, text, failed }) => ({
          id,
          role,
          text,
          failed,
        })),
        events: attempt.state.events,
        runs: attempt.state.runs,
        reflection,
      }),
      output: Output.object({
        schema: jsonSchema<{ prompt: ReviewSection; process: ReviewSection }>(
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              prompt: evidenceSectionSchema,
              process: evidenceSectionSchema,
            },
            required: ['prompt', 'process'],
          },
          {
            validate: (value) => {
              const checked = Joi.object({
                prompt: sectionValidator.required(),
                process: sectionValidator.required(),
              }).validate(value);
              return checked.error
                ? { success: false, error: checked.error }
                : {
                    success: true,
                    value: checked.value as {
                      prompt: ReviewSection;
                      process: ReviewSection;
                    },
                  };
            },
          },
        ),
      }),
    });
    for (const section of [output.prompt, output.process]) {
      section.feedback = safeText(section.feedback);
      if (section.evidence.some((id) => !evidenceIds.has(id)))
        throw new Error('Evaluation referenced unknown evidence');
    }
    return output;
  }
}
