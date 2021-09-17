import {
  makeExecutableSchema,
  IExecutableSchemaDefinition,
} from "@graphql-tools/schema";
import { User, Prisma } from "@prisma/client";
import { GraphQLContext } from "./context";
import { hash, compare } from "bcryptjs";
import { sign } from "jsonwebtoken";

export const APP_SECRET = "this is my secret";

const typeDefs = /* GraphQL */ `
  input LinkOrderByInput {
    description: Sort
    url: Sort
    createdAt: Sort
  }

  enum Sort {
    asc
    desc
  }

  type Feed {
    links: [Link!]!
    count: Int!
  }

  type Query {
    info: String!
    feed(filter: String, skip: Int, take: Int, orderBy: LinkOrderByInput): Feed!
    me: User!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    links: [Link!]!
  }

  type Mutation {
    post(url: String!, description: String!): Link!
    signup(email: String!, password: String!, name: String!): AuthPayload
    login(email: String!, password: String!): AuthPayload
  }

  type Link {
    id: ID!
    description: String!
    url: String!
    postedBy: User
  }
`;

const resolvers: IExecutableSchemaDefinition["resolvers"] = {
  Query: {
    info: () => `This is the API of a Hackernews Clone`,
    me: (_, __, context: GraphQLContext) => {
      if (!context.currentUser) {
        throw new Error("Unauthenticated ");
      }

      return context.currentUser;
    },
    feed: async (
      _,
      args: {
        filter?: string;
        skip?: number;
        take?: number;
        orderBy?: {
          description?: Prisma.SortOrder;
          url?: Prisma.SortOrder;
          createdAt?: Prisma.SortOrder;
        };
      },
      context: GraphQLContext
    ) => {
      const where = args.filter
        ? {
            OR: [
              { description: { contains: args.filter } },
              { url: { contains: args.filter } },
            ],
          }
        : {};

      const totalCount = await context.prisma.link.count({ where });
      const links = context.prisma.link.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: args.orderBy,
      });

      return { links, count: totalCount };
    },
  },
  User: {
    links: (parent: User, _, context: GraphQLContext) =>
      context.prisma.user.findUnique({ where: { id: parent.id } }).links(),
  },
  Link: {
    id: (parent: any) => parent.id,
    description: (parent: any) => parent.description,
    url: (parent: any) => parent.url,
    postedBy: (parent: any, _, context: GraphQLContext) => {
      if (!parent.postedById) {
        return null;
      }

      return context.prisma.link
        .findUnique({
          where: { id: parent.id },
        })
        .postedBy();
    },
  },
  Mutation: {
    post: async (
      _,
      args: { url: string; description: string },
      context: GraphQLContext
    ) => {
      if (context.currentUser === null) {
        throw new Error("Unauthenticated!");
      }

      const newLink = await context.prisma.link.create({
        data: {
          ...args,
          postedBy: { connect: { id: context.currentUser.id } },
        },
      });

      return newLink;
    },
    signup: async (
      _,
      args: { email: string; password: string; name: string },
      context: GraphQLContext
    ) => {
      const password = await hash(args.password, 10);

      const user = await context.prisma.user.create({
        data: { ...args, password },
      });

      const token = sign({ userId: user.id }, APP_SECRET);

      return {
        token,
        user,
      };
    },
    login: async (
      _,
      args: { email: string; password: string },
      context: GraphQLContext
    ) => {
      const user = await context.prisma.user.findUnique({
        where: { email: args.email },
      });

      if (!user) {
        throw new Error("No such user found");
      }

      const valid = await compare(args.password, user.password);

      if (!valid) {
        throw new Error("Invalid password");
      }

      const token = sign({ userId: user.id }, APP_SECRET);

      return {
        user,
        token,
      };
    },
  },
};

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});
