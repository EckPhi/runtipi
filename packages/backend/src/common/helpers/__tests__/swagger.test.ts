import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { type } from 'arktype';
import { createArkDto } from 'nestjs-arktype';
import { expect, it } from 'vitest';

it('preserves union schemas without adding an explicit string constraint', async () => {
  class UnionDto extends createArkDto(
    type({
      object: type({ value: 'number' }).or('null'),
      'text?': 'string | null',
      scalar: 'number | string',
      input: type('string.integer.parse').or('number'),
      ordinary: 'string',
      nested: type({ value: 'string | null' }),
    }),
    { name: 'UnionDto', input: true },
  ) {}
  const module = await Test.createTestingModule({}).compile();
  const app = module.createNestApplication();
  try {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setOpenAPIVersion('3.1.0').build(), { extraModels: [UnionDto] });
    const schema = document.components?.schemas?.UnionDto;
    expect(schema).toMatchObject({
      properties: {
        object: { anyOf: [{ type: 'object' }, { type: 'null' }] },
        ordinary: { type: 'string' },
      },
    });
    if (!schema || !('properties' in schema)) throw new Error('Missing DTO schema');
    for (const key of ['object', 'text', 'scalar', 'input']) {
      expect(schema.properties?.[key]).not.toHaveProperty('type');
    }
    expect(schema.required).toContain('object');
    expect(schema.required).not.toContain('text');
  } finally {
    await app.close();
  }
});
