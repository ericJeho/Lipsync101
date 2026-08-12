import { Router } from 'express';
import {
  buildSchema,
  graphql,
  GraphQLError,
  printSchema,
  specifiedRules,
  validate,
  parse,
} from 'graphql';
import { z } from 'zod';
import { ENGINE_LIST, PLAN_LIST } from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { requireAuth, type AuthenticatedActor } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

/**
 * A read-oriented GraphQL surface over the same data as the REST API.
 *
 * Writes stay REST-only on purpose: rendering charges credits and enforces plan
 * limits, and having one place where that happens is worth more than symmetry
 * between the two APIs.
 */
export const graphqlRouter = Router();

export const schema = buildSchema(`
  scalar DateTime
  scalar JSON

  type Engine {
    id: String!
    name: String!
    tagline: String!
    description: String!
    creditMultiplier: Float!
    licence: String!
  }

  type Plan {
    id: String!
    name: String!
    monthlyUsd: Float!
    yearlyUsd: Float!
    features: [String!]!
  }

  type User {
    id: ID!
    email: String!
    name: String
    plan: String!
    credits: Int!
    storageUsedBytes: Float!
    createdAt: DateTime!
  }

  type Project {
    id: ID!
    name: String!
    description: String
    favorite: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    jobs: [Job!]!
  }

  type Job {
    id: ID!
    status: String!
    progress: Int!
    stage: String!
    engine: String!
    preset: String!
    outputFormat: String!
    outputHeight: Int!
    enhancements: [String!]!
    creditsCharged: Int!
    etaSeconds: Int
    error: String
    outputUrl: String
    thumbnailUrl: String
    analysis: JSON
    createdAt: DateTime!
    completedAt: DateTime
    project: Project
  }

  type JobPage {
    jobs: [Job!]!
    total: Int!
  }

  type Query {
    me: User!
    engines: [Engine!]!
    plans: [Plan!]!
    project(id: ID!): Project
    projects(take: Int = 25, skip: Int = 0): [Project!]!
    job(id: ID!): Job
    jobs(take: Int = 25, skip: Int = 0, status: String): JobPage!
  }
`);

interface GraphQLContext {
  actor: AuthenticatedActor;
}

/**
 * Resolvers are scoped by the authenticated actor at every entry point. There
 * is no unscoped `jobs` or `projects` lookup, so a caller cannot walk to
 * another account's data by guessing an id.
 */
const rootValue = {
  me: async (_args: unknown, context: GraphQLContext) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: context.actor.userId },
    });
    return serialiseBigInts({ ...user, storageUsedBytes: Number(user.storageUsedBytes) });
  },

  engines: () => ENGINE_LIST,
  plans: () => PLAN_LIST,

  project: async ({ id }: { id: string }, context: GraphQLContext) => {
    const project = await prisma.project.findFirst({
      where: { id, userId: context.actor.userId },
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    return project ? serialiseBigInts(project) : null;
  },

  projects: async (
    { take, skip }: { take: number; skip: number },
    context: GraphQLContext,
  ) => {
    const projects = await prisma.project.findMany({
      where: { userId: context.actor.userId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(take, 100),
      skip,
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    return serialiseBigInts(projects);
  },

  job: async ({ id }: { id: string }, context: GraphQLContext) => {
    const job = await prisma.job.findFirst({
      where: { id, userId: context.actor.userId },
      include: { project: true },
    });
    return job ? serialiseBigInts(job) : null;
  },

  jobs: async (
    { take, skip, status }: { take: number; skip: number; status?: string },
    context: GraphQLContext,
  ) => {
    const where = {
      userId: context.actor.userId,
      ...(status ? { status: status as never } : {}),
    };
    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(take, 100),
        skip,
        include: { project: true },
      }),
      prisma.job.count({ where }),
    ]);
    return { jobs: serialiseBigInts(jobs), total };
  },
};

/**
 * Rejects queries nested deeper than `limit`.
 *
 * GraphQL's graph shape lets a small query expand exponentially
 * (`project { jobs { project { jobs ... } } }`), so a depth ceiling is the
 * cheapest defence against a query designed to exhaust the database.
 */
export function exceedsDepth(query: string, limit = 8): boolean {
  let depth = 0;
  let maxDepth = 0;
  for (const character of query) {
    if (character === '{') {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
    } else if (character === '}') {
      depth -= 1;
    }
  }
  return maxDepth > limit;
}

graphqlRouter.post(
  '/',
  requireAuth(),
  validateBody(
    z.object({
      query: z.string().min(1).max(10_000),
      variables: z.record(z.unknown()).optional(),
      operationName: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const { query, variables, operationName } = req.body as {
        query: string;
        variables?: Record<string, unknown>;
        operationName?: string;
      };

      if (exceedsDepth(query)) {
        throw ApiError.badRequest('That query nests too deeply. Flatten it and try again.');
      }

      // Validate before executing so a malformed query costs a parse, not a
      // round of database calls.
      let document;
      try {
        document = parse(query);
      } catch (error) {
        res.status(400).json({ errors: [{ message: (error as GraphQLError).message }] });
        return;
      }

      const validationErrors = validate(schema, document, specifiedRules);
      if (validationErrors.length > 0) {
        res.status(400).json({ errors: validationErrors.map((e) => ({ message: e.message })) });
        return;
      }

      const result = await graphql({
        schema,
        source: query,
        rootValue,
        variableValues: variables,
        operationName,
        contextValue: { actor: req.actor! } satisfies GraphQLContext,
      });

      res.status(result.errors ? 400 : 200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** The SDL, so clients can generate types without a separate download. */
graphqlRouter.get('/schema', (_req, res) => {
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.send(`# LipSync Studio GraphQL schema
# POST queries to /v1/graphql with a Bearer token or X-API-Key header.

${printSchema(schema)}`);
});
