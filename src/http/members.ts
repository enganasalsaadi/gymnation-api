import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { COUNTRY_CODES, type CountryCode } from '../domain/countries';
import { parsePhone, resolvePhone } from '../domain/phone';
import type { Member, Store } from '../store';
import { AppError, notFound, validationError } from './errors';

const NAME_MAX = 120;

const invalidPhone = () => new AppError(422, 'INVALID_PHONE', 'Phone is not a valid AE, SA or BH mobile number');

interface CreateMemberBody {
  name: string;
  country: CountryCode;
  phone: string;
}

interface LookupQuery {
  phone: string;
  country?: CountryCode;
}

export function memberRoutes(app: FastifyInstance, store: Store): void {
  app.post<{ Body: CreateMemberBody }>(
    '/members',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'country', 'phone'],
          properties: {
            name: { type: 'string' },
            country: { type: 'string', enum: [...COUNTRY_CODES] },
            phone: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { country, phone } = request.body;
      const name = request.body.name.trim();
      if (name.length < 1 || name.length > NAME_MAX) {
        throw validationError(`name must be 1 to ${NAME_MAX} characters after trimming`);
      }

      const e164 = resolvePhone(parsePhone(phone), country);
      if (e164 === null) throw invalidPhone();

      const member: Member = { id: randomUUID(), name, country, phone: e164 };
      const result = store.addMember(member);
      if (!result.ok) {
        throw new AppError(409, 'PHONE_TAKEN', 'Phone number is already registered', {
          existing_member_id: result.existingId,
        });
      }
      return reply.code(201).send(member);
    },
  );

  app.get<{ Querystring: LookupQuery }>(
    '/members/lookup',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['phone'],
          properties: {
            phone: { type: 'string' },
            country: { type: 'string', enum: [...COUNTRY_CODES] },
          },
        },
      },
    },
    async (request) => {
      const { phone, country } = request.query;
      const parsed = parsePhone(phone);
      if (parsed.kind === 'invalid') throw invalidPhone();

      let e164: string;
      if (parsed.kind === 'national') {
        if (country === undefined) {
          throw new AppError(422, 'PHONE_NEEDS_COUNTRY', 'A national phone number needs the country parameter');
        }
        const resolved = resolvePhone(parsed, country);
        if (resolved === null) throw invalidPhone();
        e164 = resolved;
      } else {
        if (country !== undefined && country !== parsed.country) {
          throw new AppError(422, 'PHONE_COUNTRY_MISMATCH', `Phone dial code belongs to ${parsed.country}, not ${country}`);
        }
        e164 = parsed.e164;
      }

      const member = store.findMemberByPhone(e164);
      if (member === undefined) throw notFound('No member has this phone number');
      return member;
    },
  );
}
